function validateSignupInput(body){
    const errors = [];

    // name — required, NOT NULL, VARCHAR(120)

    if(!body.name || typeof body.name !== "string" || body.name.trim.length() === 0)
    {
        errors.push("name is required");
    }

    else if(body.name.length > 120){
        errors.push("name must be 120 characters or fewer");
    }

     // email — required, NOT NULL, VARCHAR(255)

     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

     if(!body.email || typeof body.email !== "string" || !emailRegex.test(body.email)){
        errors.push("a valid email is required");
     }

     else if(body.email.length > 255){
        errors.push("email must be 255 characters or fewer");
     }

     // password — required (becomes password_hash, not a raw column)

     if(!body.password || typeof body.password !== "string" || body.password.length < 8){
        errors.push("password must be at least 8 characters");
     }

     // phone — required, VARCHAR(30)
     
     if (!body.phone || typeof body.phone !== "string" || body.phone.length > 30) {
      errors.push("phone must be a string of 30 characters or fewer");
     }

     // city — required, VARCHAR(100)

     if (!body.city || typeof body.city !== "string" || body.city.length > 100) {
      errors.push("city must be a string of 100 characters or fewer");
    }

     // role — required, must match the user_role enum, ADMIN blocked from public signup

     const allowedRoles = ["BUYER", "SELLER"]

     if(!body.roles || !allowedRoles.includes(body.role)){
        errors.push("role must be BUYER or SELLER");
     }

    return errors;
}