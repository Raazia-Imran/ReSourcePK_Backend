const test = require("node:test");
const assert = require("node:assert/strict");
function oneRow(row) {
  return { rowCount: 1, rows: [row] };
}

const db = require("../src/db");
const orderService = require("../src/modules/orders/service");

const {
  TRANSITIONS,
  canTransition,
  assertTransition,
} = require("../src/modules/orders/orderStateMachine");

function recordTransaction(t, queries, respond) {
  t.mock.method(db, "transaction", async (work) =>
    work({
      query: async (sql, params) => {
        queries.push({ sql, params });
        return respond(sql, params);
      },
    }),
  );
}

const STATUSES = Object.keys(TRANSITIONS);

test("all permitted fulfilment transitions are accepted", () => {
  for (const [from, destinations] of Object.entries(TRANSITIONS)) {
    for (const to of destinations) {
      assert.equal(
        canTransition(from, to),
        true,
        `${from} -> ${to} should be allowed`,
      );

      assert.doesNotThrow(() => assertTransition(from, to));
    }
  }
});

test("all transitions not listed in TRANSITIONS are rejected", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      if (TRANSITIONS[from].includes(to)) {
        continue;
      }

      assert.equal(
        canTransition(from, to),
        false,
        `${from} -> ${to} should not be allowed`,
      );

      assert.throws(
        () => assertTransition(from, to),
        (error) => {
          assert.equal(error.code, "ORDER_INVALID_TRANSITION");
          return true;
        },
        `${from} -> ${to} should throw ORDER_INVALID_TRANSITION`,
      );
    }
  }
});

test("cancelled and refunded are final states", () => {
  for (const finalStatus of ["cancelled", "refunded"]) {
    assert.deepEqual(TRANSITIONS[finalStatus], []);

    for (const to of STATUSES) {
      assert.equal(canTransition(finalStatus, to), false);

      assert.throws(() => assertTransition(finalStatus, to), {
        code: "ORDER_INVALID_TRANSITION",
      });
    }
  }
});

test("unknown statuses are rejected", () => {
  assert.equal(canTransition("unknown", "paid"), false);
  assert.equal(canTransition("paid", "unknown"), false);

  assert.throws(() => assertTransition("unknown", "paid"), {
    code: "ORDER_INVALID_TRANSITION",
  });
});

test("disputed orders cannot be cancelled", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-1",
        buyer_id: "buyer-1",
        fulfilment_status: "disputed",
      });
    }

    return { rowCount: 0, rows: [] };
  });

  await assert.rejects(
    () =>
      orderService.cancelOrder(
        "order-1",
        "buyer-1",
        "Cancellation requested",
        "test-correlation",
        "buyer",
      ),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "ORDER_DISPUTED");
      return true;
    },
  );

  assert.equal(
    queries.some((query) =>
      query.sql.includes("UPDATE app.inventory_reservations"),
    ),
    false,
    "A disputed order must not release its reservation",
  );
});

test("cancelling an eligible order releases active and committed reservations", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-2",
        buyer_id: "buyer-1",
        fulfilment_status: "paid",
      });
    }

    return { rowCount: 1, rows: [] };
  });

  await orderService.cancelOrder(
    "order-2",
    "buyer-1",
    "Changed my mind",
    "test-correlation",
    "buyer",
  );

  const reservationUpdate = queries.find((query) =>
    query.sql.includes("UPDATE app.inventory_reservations"),
  );

  assert.ok(reservationUpdate, "The reservation should be updated");

  assert.match(
    reservationUpdate.sql,
    /status IN\s*\('active',\s*'committed'\)/,
    "Both active and committed reservations should be released",
  );

  assert.deepEqual(reservationUpdate.params, ["order-2"]);

  const orderUpdate = queries.find(
    (query) =>
      query.sql.includes("UPDATE app.orders") &&
      query.sql.includes("fulfilment_status"),
  );

  assert.ok(orderUpdate, "The order status should be updated");
});

test("repeated cancellation does not create duplicate events or audit records", async (t) => {
  const queries = [];
  let currentStatus = "paid";

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-3",
        buyer_id: "buyer-1",
        fulfilment_status: currentStatus,
      });
    }

    if (
      sql.includes("UPDATE app.orders") &&
      sql.includes("fulfilment_status")
    ) {
      currentStatus = "cancelled";
    }

    return { rowCount: 1, rows: [] };
  });

  await orderService.cancelOrder(
    "order-3",
    "buyer-1",
    "Changed my mind",
    "test-correlation",
    "buyer",
  );

  await orderService.cancelOrder(
    "order-3",
    "buyer-1",
    "Changed my mind",
    "test-correlation",
    "buyer",
  );

  const eventInserts = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.order_events"),
  );

  const auditInserts = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.audit_events"),
  );

  const reservationUpdates = queries.filter((query) =>
    query.sql.includes("UPDATE app.inventory_reservations"),
  );

  assert.equal(eventInserts.length, 1);
  assert.equal(auditInserts.length, 1);
  assert.equal(reservationUpdates.length, 1);
});

test("buyers cannot use the general transition function", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-4",
        buyer_id: "buyer-1",
        fulfilment_status: "paid",
        organization_id: "org-1",
      });
    }

    return { rowCount: 1, rows: [] };
  });

  await assert.rejects(
    () =>
      orderService.transitionOrder(
        "order-4",
        "buyer-1",
        "processing",
        "Trying to process order",
        "test-correlation",
        "buyer",
      ),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, "ORDER_ACTION_DENIED");
      return true;
    },
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    false,
    "A buyer must not update fulfilment status through this function",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.order_events")),
    false,
    "A rejected transition must not create an order event",
  );
});

//an authorized seller successfully moves an order from paid to processing

test("authorized sellers can move paid orders to processing", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-seller-1",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: "paid",
      });
    }

    if (sql.includes("FROM app.organization_memberships")) {
      return oneRow({
        id: "membership-1",
        role: "owner",
      });
    }

    if (sql.includes("FROM app.organization_membership_permissions")) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes("UPDATE app.orders")) {
      return oneRow({
        id: "order-seller-1",
        fulfilment_status: "processing",
      });
    }

    return { rowCount: 1, rows: [] };
  });

  const updatedOrder = await orderService.transitionOrder(
    "order-seller-1",
    "seller-1",
    "processing",
    "Preparing the order",
    "test-correlation",
    "seller",
    "org-1",
  );

  assert.equal(updatedOrder.fulfilment_status, "processing");

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    true,
    "The authorized seller should update the order",
  );

  assert.equal(
    queries.filter((query) =>
      query.sql.includes("INSERT INTO app.order_events"),
    ).length,
    1,
    "The transition should create one order event",
  );

  assert.equal(
    queries.filter((query) =>
      query.sql.includes("INSERT INTO app.audit_events"),
    ).length,
    1,
    "The seller action should create one audit record",
  );
});

//an illegal seller status jump

test("sellers cannot skip fulfilment steps", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-seller-1",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: "paid",
      });
    }

    if (sql.includes("FROM app.organization_memberships")) {
      return oneRow({
        id: "membership-1",
        role: "owner",
      });
    }

    if (sql.includes("FROM app.organization_membership_permissions")) {
      return { rowCount: 0, rows: [] };
    }

    return { rowCount: 1, rows: [] };
  });

  await assert.rejects(
    orderService.transitionOrder(
      "order-seller-1",
      "seller-1",
      "dispatched",
      "Trying to dispatch directly",
      "test-correlation",
      "seller",
      "org-1",
    ),
    (error) => error.code === "ORDER_INVALID_TRANSITION",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    false,
    "An invalid transition should not update the order",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.order_events")),
    false,
    "An invalid transition should not create an order event",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.audit_events")),
    false,
    "An invalid transition should not create an audit record",
  );
});

//test covering both remaining seller transitions: processing → ready and ready → dispatched

test("authorized sellers can move processing orders to ready and dispatched", async (t) => {
  const queries = [];
  let currentStatus = "processing";

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-seller-2",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: currentStatus,
      });
    }

    if (sql.includes("FROM app.organization_memberships")) {
      return oneRow({ id: "membership-1", role: "owner" });
    }

    if (sql.includes("FROM app.organization_membership_permissions")) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes("UPDATE app.orders")) {
      currentStatus = params[1];

      return oneRow({
        id: "order-seller-2",
        fulfilment_status: currentStatus,
      });
    }

    return { rowCount: 1, rows: [] };
  });

  const readyOrder = await orderService.transitionOrder(
    "order-seller-2",
    "seller-1",
    "ready",
    "Order is ready",
    "test-correlation",
    "seller",
    "org-1",
  );

  assert.equal(readyOrder.fulfilment_status, "ready");

  const dispatchedOrder = await orderService.transitionOrder(
    "order-seller-2",
    "seller-1",
    "dispatched",
    "Order has been dispatched",
    "test-correlation",
    "seller",
    "org-1",
  );

  assert.equal(dispatchedOrder.fulfilment_status, "dispatched");

  assert.equal(
    queries.filter((query) =>
      query.sql.includes("INSERT INTO app.order_events"),
    ).length,
    2,
    "Both transitions should create order events",
  );

  assert.equal(
    queries.filter((query) =>
      query.sql.includes("INSERT INTO app.audit_events"),
    ).length,
    2,
    "Both seller transitions should create audit records",
  );
});

//test a manager who does not have the orders.confirm permission.
//The service should reject the request with ORDER_DECISION_DENIED and make no changes.

test("sellers without orders.confirm permission cannot update orders", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-seller-1",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: "paid",
      });
    }

    if (sql.includes("FROM app.organization_memberships")) {
      return oneRow({
        id: "membership-1",
        role: "manager",
      });
    }

    if (sql.includes("FROM app.organization_membership_permissions")) {
      return { rowCount: 0, rows: [] };
    }

    return { rowCount: 1, rows: [] };
  });

  await assert.rejects(
    orderService.transitionOrder(
      "order-seller-1",
      "seller-1",
      "processing",
      "Trying to process the order",
      "test-correlation",
      "seller",
      "org-1",
    ),
    (error) => error.code === "ORDER_DECISION_DENIED",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    false,
    "A manager without permission should not update the order",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.order_events")),
    false,
    "A denied action should not create an order event",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.audit_events")),
    false,
    "A denied action should not create an audit record",
  );
});

//seller organization isolation: a seller from org-2 must not be able to access an order belonging to org-1.

test("sellers cannot update orders belonging to another organization", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      // Simulate the organization-scoped order lookup.
      if (params[1] === "org-2") {
        return { rowCount: 0, rows: [] };
      }

      return oneRow({
        id: "order-seller-1",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: "paid",
      });
    }

    return { rowCount: 0, rows: [] };
  });

  await assert.rejects(
    orderService.transitionOrder(
      "order-seller-1",
      "seller-2",
      "processing",
      "Trying to process another organization's order",
      "test-correlation",
      "seller",
      "org-2",
    ),
    (error) => error.status === 404 && error.code === "ORDER_NOT_FOUND",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    false,
    "A seller from another organization must not update the order",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.order_events")),
    false,
    "A seller from another organization must not create an order event",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.audit_events")),
    false,
    "A seller from another organization must not create an audit record",
  );
});

//a seller must not be able to move an order directly from paid to completed

test("sellers cannot move paid orders directly to completed", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-seller-1",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: "paid",
      });
    }

    if (sql.includes("FROM app.organization_memberships")) {
      return oneRow({
        id: "membership-1",
        role: "owner",
      });
    }

    if (sql.includes("FROM app.organization_membership_permissions")) {
      return { rowCount: 0, rows: [] };
    }

    return { rowCount: 1, rows: [] };
  });

  await assert.rejects(
    orderService.transitionOrder(
      "order-seller-1",
      "seller-1",
      "completed",
      "Trying to complete the order directly",
      "test-correlation",
      "seller",
      "org-1",
    ),
    (error) => error.code === "ORDER_INVALID_TRANSITION",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    false,
    "An invalid transition must not update the order",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.order_events")),
    false,
    "An invalid transition must not create an order event",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.audit_events")),
    false,
    "An invalid transition must not create an audit record",
  );
});

//concurrent duplicate seller requests

test("concurrent duplicate seller requests create only one transition", async (t) => {
  const queries = [];
  let fulfilmentStatus = "paid";

  const runner = {
    query: async (sql, params) => {
      queries.push({ sql, params });

      if (sql.includes("FROM app.orders")) {
        return oneRow({
          id: "order-seller-1",
          buyer_id: "buyer-1",
          organization_id: "org-1",
          fulfilment_status: fulfilmentStatus,
        });
      }

      if (sql.includes("FROM app.organization_memberships")) {
        return oneRow({
          id: "membership-1",
          role: "owner",
        });
      }

      if (sql.includes("FROM app.organization_membership_permissions")) {
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes("UPDATE app.orders")) {
        fulfilmentStatus = params[1];

        return oneRow({
          id: "order-seller-1",
          fulfilment_status: fulfilmentStatus,
        });
      }

      return { rowCount: 1, rows: [] };
    },
  };

  // Serialize mocked transactions to simulate the database row lock.
  let transactionQueue = Promise.resolve();

  t.mock.method(db, "transaction", async (work) => {
    const previousTransaction = transactionQueue;

    let releaseTransaction;

    transactionQueue = new Promise((resolve) => {
      releaseTransaction = resolve;
    });

    await previousTransaction;

    try {
      return await work(runner);
    } finally {
      releaseTransaction();
    }
  });

  const request = () =>
    orderService.transitionOrder(
      "order-seller-1",
      "seller-1",
      "processing",
      "Preparing the order",
      "test-correlation",
      "seller",
      "org-1",
    );

  const results = await Promise.all([request(), request()]);

  assert.equal(results.length, 2);

  assert.equal(results[0].fulfilment_status, "processing");

  assert.equal(results[1].fulfilment_status, "processing");

  assert.equal(
    queries.filter((query) => query.sql.includes("UPDATE app.orders")).length,
    1,
    "Only one request should update the order",
  );

  assert.equal(
    queries.filter((query) =>
      query.sql.includes("INSERT INTO app.order_events"),
    ).length,
    1,
    "Only one order event should be created",
  );

  assert.equal(
    queries.filter((query) =>
      query.sql.includes("INSERT INTO app.audit_events"),
    ).length,
    1,
    "Only one audit record should be created",
  );
});

//verify that the actual buyer can confirm receipt of a dispatched order and that the service records both fulfilment events

test("buyers can confirm receipt and complete dispatched orders", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("JOIN app.listings")) {
      return oneRow({
        id: "order-receipt-1",
        listing_id: "listing-1",
        quantity: "12.500",
        unit: "kg",
        completed_at: "2026-11-08T10:00:00.000Z",
        fulfilment_status: "completed",
        material: "Cotton",
        composition: "100% Cotton",
        color: "White",
        condition: "Good",
      });
    }

    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-receipt-1",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: "dispatched",
      });
    }

    if (sql.includes("UPDATE app.orders")) {
      return oneRow({
        id: "order-receipt-1",
        fulfilment_status: "completed",
      });
    }

    if (sql.includes("INSERT INTO app.passport_snapshots")) {
      return oneRow({
        id: params[0],
        order_id: params[1],
        version: 1,
        canonical_json: params[2],
        snapshot_data: params[3],
        passport_hash: params[4],
        status: "pending",
      });
    }

    return { rowCount: 1, rows: [] };
  });

  const completedOrder = await orderService.confirmReceipt(
    "order-receipt-1",
    "buyer-1",
    "Order received successfully",
    "test-correlation",
  );

  assert.equal(completedOrder.fulfilment_status, "completed");

  const eventInserts = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.order_events"),
  );

  assert.equal(eventInserts.length, 2);

  assert.deepEqual(
    eventInserts.map((query) => [query.params[3], query.params[4]]),
    [
      ["dispatched", "delivered"],
      ["delivered", "completed"],
    ],
  );

  assert.equal(
    queries.filter((query) =>
      query.sql.includes("INSERT INTO app.audit_events"),
    ).length,
    1,
    "Receipt confirmation should create one audit record",
  );
});

//A different buyer must not be able to confirm receipt.
//Repeated receipt confirmation must not create duplicate events or audit records.

test("other buyers cannot confirm receipt of someone else's order", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("JOIN app.listings")) {
      return oneRow({
        id: "order-receipt-1",
        listing_id: "listing-1",
        quantity: "12.500",
        unit: "kg",
        completed_at: "2026-11-08T10:00:00.000Z",
        fulfilment_status: "completed",
        material: "Cotton",
        composition: "100% Cotton",
        color: "White",
        condition: "Good",
      });
    }

    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-receipt-2",
        buyer_id: "buyer-1",
        fulfilment_status: "dispatched",
      });
    }

    return { rowCount: 1, rows: [] };
  });

  await assert.rejects(
    () =>
      orderService.confirmReceipt(
        "order-receipt-2",
        "buyer-2",
        "Trying to confirm someone else's order",
        "test-correlation",
      ),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.code, "ORDER_NOT_FOUND");
      return true;
    },
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    false,
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.order_events")),
    false,
  );

  assert.equal(
    queries.some((query) => query.sql.includes("INSERT INTO app.audit_events")),
    false,
  );
});

//receipt-confirmation tests with idempotency: confirming an already completed order must not create duplicate events or audit records.

test("repeated receipt confirmation does not create duplicate events or audit records", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-receipt-3",
        buyer_id: "buyer-1",
        fulfilment_status: "completed",
      });
    }

    return { rowCount: 1, rows: [] };
  });

  const completedOrder = await orderService.confirmReceipt(
    "order-receipt-3",
    "buyer-1",
    "Confirming receipt again",
    "test-correlation",
  );

  assert.equal(completedOrder.fulfilment_status, "completed");

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    false,
    "An already completed order should not be updated again",
  );

  assert.equal(
    queries.filter((query) =>
      query.sql.includes("INSERT INTO app.order_events"),
    ).length,
    0,
    "Repeated confirmation must not create duplicate order events",
  );

  assert.equal(
    queries.filter((query) =>
      query.sql.includes("INSERT INTO app.audit_events"),
    ).length,
    0,
    "Repeated confirmation must not create another audit record",
  );
});

test("refund simulation updates payment and order only once", async (t) => {
  const queries = [];
  let currentStatus = "paid";

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-refund-1",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: currentStatus,
      });
    }

    if (sql.includes("FROM app.platform_assignments")) {
      return oneRow({ "?column?": 1 });
    }

    if (sql.includes("FROM app.payment_attempts")) {
      return oneRow({ id: "payment-1", status: "succeeded" });
    }

    if (
      sql.includes("UPDATE app.orders") &&
      sql.includes("fulfilment_status")
    ) {
      currentStatus = "refunded";

      return oneRow({
        id: "order-refund-1",
        fulfilment_status: "refunded",
      });
    }

    return { rowCount: 1, rows: [] };
  });

  await orderService.simulateRefund(
    "order-refund-1",
    "admin-1",
    "Refund approved",
    "test-correlation",
  );

  await orderService.simulateRefund(
    "order-refund-1",
    "admin-1",
    "Refund approved",
    "test-correlation",
  );

  const paymentUpdates = queries.filter((query) =>
    query.sql.includes("UPDATE app.payment_attempts"),
  );

  const orderEvents = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.order_events"),
  );

  const auditEvents = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.audit_events"),
  );

  assert.equal(paymentUpdates.length, 1);
  assert.equal(orderEvents.length, 1);
  assert.equal(auditEvents.length, 1);

  assert.equal(currentStatus, "refunded");

  assert.match(paymentUpdates[0].sql, /status\s*=\s*'refunded'/);
});

test("non-admin users cannot simulate refunds", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-refund-2",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: "paid",
      });
    }

    if (sql.includes("FROM app.platform_assignments")) {
      return { rowCount: 0, rows: [] };
    }

    return { rowCount: 1, rows: [] };
  });

  await assert.rejects(
    () =>
      orderService.simulateRefund(
        "order-refund-2",
        "ordinary-user",
        "Refund requested",
        "test-correlation",
      ),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, "PLATFORM_ADMIN_REQUIRED");
      return true;
    },
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    false,
    "An unauthorized user must not update the order",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.payment_attempts")),
    false,
    "An unauthorized user must not update payment status",
  );
});

test("refund simulation rejects orders without a successful payment", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-refund-3",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: "paid",
      });
    }

    if (sql.includes("FROM app.platform_assignments")) {
      return oneRow({ "?column?": 1 });
    }

    if (sql.includes("FROM app.payment_attempts")) {
      return { rowCount: 0, rows: [] };
    }

    return { rowCount: 1, rows: [] };
  });

  await assert.rejects(
    () =>
      orderService.simulateRefund(
        "order-refund-3",
        "admin-1",
        "Refund requested",
        "test-correlation",
      ),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "PAYMENT_NOT_REFUNDABLE");
      return true;
    },
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.orders")),
    false,
    "The order must not be refunded without successful payment",
  );

  assert.equal(
    queries.some((query) => query.sql.includes("UPDATE app.payment_attempts")),
    false,
    "Payment status must remain unchanged",
  );
});

test("buyers can raise a dispute and create a dispute record", async (t) => {
  const queries = [];

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-dispute-1",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: "paid",
      });
    }

    if (
      sql.includes("UPDATE app.orders") &&
      sql.includes("fulfilment_status")
    ) {
      return oneRow({
        id: "order-dispute-1",
        fulfilment_status: "disputed",
      });
    }

    return { rowCount: 1, rows: [] };
  });

  await orderService.raiseDispute(
    "order-dispute-1",
    "buyer-1",
    "Item arrived damaged",
    "test-correlation",
    "buyer",
  );

  const disputeInserts = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.disputes"),
  );

  const orderUpdates = queries.filter(
    (query) =>
      query.sql.includes("UPDATE app.orders") &&
      query.sql.includes("fulfilment_status"),
  );

  const orderEvents = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.order_events"),
  );

  const auditEvents = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.audit_events"),
  );

  assert.equal(disputeInserts.length, 1);
  assert.equal(disputeInserts[0].params[0], "order-dispute-1");
  assert.equal(disputeInserts[0].params[1], "buyer-1");
  assert.equal(disputeInserts[0].params[2], "Item arrived damaged");
  assert.equal(disputeInserts[0].params[3], "open");

  assert.equal(orderUpdates.length, 1);
  assert.equal(orderEvents.length, 1);
  assert.equal(auditEvents.length, 1);
});

test("repeated dispute requests do not create duplicate records or events", async (t) => {
  const queries = [];
  let currentStatus = "paid";

  recordTransaction(t, queries, async (sql, params) => {
    if (sql.includes("FROM app.orders")) {
      return oneRow({
        id: "order-dispute-2",
        buyer_id: "buyer-1",
        organization_id: "org-1",
        fulfilment_status: currentStatus,
      });
    }

    if (
      sql.includes("UPDATE app.orders") &&
      sql.includes("fulfilment_status")
    ) {
      currentStatus = "disputed";

      return oneRow({
        id: "order-dispute-2",
        fulfilment_status: "disputed",
      });
    }

    return { rowCount: 1, rows: [] };
  });

  await orderService.raiseDispute(
    "order-dispute-2",
    "buyer-1",
    "Item arrived damaged",
    "test-correlation",
    "buyer",
  );

  await orderService.raiseDispute(
    "order-dispute-2",
    "buyer-1",
    "Item arrived damaged",
    "test-correlation",
    "buyer",
  );

  const disputeInserts = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.disputes"),
  );

  const orderEvents = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.order_events"),
  );

  const auditEvents = queries.filter((query) =>
    query.sql.includes("INSERT INTO app.audit_events"),
  );

  assert.equal(disputeInserts.length, 1);
  assert.equal(orderEvents.length, 1);
  assert.equal(auditEvents.length, 1);
  assert.equal(currentStatus, "disputed");
});
