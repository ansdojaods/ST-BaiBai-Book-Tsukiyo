/** 运行全部测试：node tests/run-all.cjs（先 npx tsc -p tsconfig.test.json） */
const harness = require("./harness.cjs");
require("./core.test.cjs");
require("./service.test.cjs");
void harness.run();
