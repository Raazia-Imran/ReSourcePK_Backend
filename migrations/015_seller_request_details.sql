ALTER TABLE app.seller_requests
  ADD COLUMN applicant_name VARCHAR(120),
  ADD COLUMN contact_number VARCHAR(32),
  ADD COLUMN business_address VARCHAR(500),
  ADD COLUMN cnic_ciphertext BYTEA,
  ADD COLUMN cnic_nonce BYTEA,
  ADD COLUMN cnic_auth_tag BYTEA,
  ADD COLUMN cnic_last_four CHAR(4);

ALTER TABLE app.seller_requests
  ADD CONSTRAINT seller_requests_applicant_name_length
    CHECK (applicant_name IS NULL OR length(trim(applicant_name)) BETWEEN 2 AND 120),
  ADD CONSTRAINT seller_requests_contact_number_length
    CHECK (contact_number IS NULL OR length(trim(contact_number)) BETWEEN 7 AND 32),
  ADD CONSTRAINT seller_requests_business_address_length
    CHECK (business_address IS NULL OR length(trim(business_address)) BETWEEN 5 AND 500),
  ADD CONSTRAINT seller_requests_cnic_encryption_fields
    CHECK (
      (cnic_ciphertext IS NULL AND cnic_nonce IS NULL AND cnic_auth_tag IS NULL AND cnic_last_four IS NULL)
      OR
      (cnic_ciphertext IS NOT NULL AND octet_length(cnic_ciphertext) = 13
       AND octet_length(cnic_nonce) = 12
       AND octet_length(cnic_auth_tag) = 16 AND cnic_last_four ~ '^[0-9]{4}$')
    );

COMMENT ON COLUMN app.seller_requests.cnic_ciphertext IS
  'AES-256-GCM encrypted CNIC; decrypt only for authorized Seller request reviewers.';
