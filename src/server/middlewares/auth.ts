import { Request, Response, NextFunction } from "express";

// Auth middleware check if request is coming from our server. by checking authorization header and matching with AUTH_TOKEN in .env
// it is disabled in development environment

const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  //   Skips in Development
  if (process.env.NODE_ENV === "development") {
    next();
    return;
  }

  const authToken = req.headers["authorization"];

  if (!authToken) {
    res.status(401).send("Authorization token is required");
    return;
  }

  if (authToken !== process.env.AUTH_TOKEN) {
    res.status(403).send("Invalid authorization token");
    return;
  }

  next();
};

export default authMiddleware;
