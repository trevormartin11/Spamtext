/** Run the daily pipeline locally: npm run pipeline:run */
import { runDaily } from "../lib/pipeline";
runDaily().then((s) => { console.log(s); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
