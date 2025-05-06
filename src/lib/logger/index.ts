import { createLogger } from "winston";

import { stdout } from "../winston";

export default createLogger({
  transports: [stdout]
});
