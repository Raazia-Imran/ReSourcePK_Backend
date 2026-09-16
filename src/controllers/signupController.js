function signupController(req, res){

    const errors = validateSignupInput(req.body);

    if(errors.length > 0){
         return res.status(400).json({ errors });
    }
}