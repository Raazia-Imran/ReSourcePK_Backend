// function signupController(req, res){

//     const errors = validateSignupInput(req.body);

//     if(errors.length > 0){
//          return res.status(400).json({ errors });
//     }
// }

async function signupController(req, res) {
  const { name, email, password, phone, city, role } = req.body;

  try {
    // Step 2: check for existing user
    const existingUser = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: "email already registered" });
    }

    // step 3 (password hashing) goes here next...

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "something went wrong" });
  }
}

module.exports = signupController;