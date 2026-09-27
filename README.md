# AI效果图智能助理工程师交接

当前基准：2026-09-22，S1收尾及规则多选本批交付后暂停，1.0整体未完成。

仅五项资料：01_Source_Code完整程序源码；02_Product_Requirements产品需求；03_Development_Status完成度；04_Known_Issues问题；05_Current_Latest_Stage最新阶段。建议按05→02→03→04→01阅读。

共35条需求：已完成15、部分完成16、未完成4；17项问题/待优化。统计为功能组，不代表工时百分比。源码111文件原样复制（包括测试），保留现有原生JS/Node/SQLite/sharp结构，未改依赖和业务代码。

安全排除：真实.env、所有业务数据库及客户上传/导出、账号会话、密钥配置、work临时目录、缓存、node_modules、客户种子Logo、历史备份和旧版本文档。保留5张初始产品图。本包不是包含客户数据的迁移包；缺客户Logo的seed测试需工程师自备脱敏素材，详见05。没有为了让扫描无关键字而删除认证或API代码；测试中的test-only凭据是假值，不能用作真实密钥。

本次不运行原项目测试、不修改/初始化原库、不修Bug。目录无Git，以下为原样源码SHA-256校验表。与原项目文件逐一一致；运行数据核对使用只读查询。

## 源码校验

| 文件 | SHA-256 |
|---|---|
| .gitignore | 80b971c3a29905282b8f25fb3ce880435ab071ec8b35742fa3d29814989027f3 |
| acceptance-demo.mjs | 0eba8997f60d4c4fe27ce1704f8964eed4ee147f020fe60f0790cdf294477423 |
| acceptance-launch.mjs | 40a67a771ceddcdda6dba22174b4835b55e51b50c0946b966700db35ed09478d |
| acceptance.mjs | ec41788dbed2a5670e01165101087436e75de67fbb308d2a8017b49ac97ba9a7 |
| additions.mjs | 39d708b77f3db39f629857256f930a59c4b3f6a8963cbd7512414acfa484311b |
| ai-pixels.mjs | bc67518830c9952dc05aaaaf01888d846339dc73a5e5c697031f78ba831214a0 |
| ai-provider.mjs | c239134fc7c58ec827ed23f6ee6628b061486decc184442a34620330ec06ec2b |
| ai-renderer.mjs | 7bf698cff82bb8a964f186be3695eecee8935e60eabf460777d55032aae35745 |
| ai-schema.sql | 8d684b82e3b60a590daa1f7041035ed7d1d8e5f8138352b36017805cc56a4cd1 |
| apimart-provider.mjs | 50c5695f998a211afb4342e05beeba187a93172ea3fe7a3d91bcdefea118692f |
| automatic-render.mjs | 9b36833dad27dfe121d7b34894d8f4c818c61c935e33f356f8e7158e722a395a |
| batch-schema.sql | 0511dcf70c3281144656aabfef2e9ecdfca6eaee83ac9630d9661f07950f6f9c |
| batches.mjs | cec5f899d77f1e0b1ed4bbb9206ede2152cd3ce05208a081ae7e91dee0993530 |
| carrier-colors.mjs | b99600dab6544cd9bbad49898dc2a907d696c90bc31e5fe4100e6a233044d5c4 |
| current-stage-launch.mjs | 8c40de52d4406a83268b003db52ed5f957a2bfa99961cc212488e632a573b200 |
| customer-revisions.mjs | 4f412d926c331c56738d5b581d820bef800473d95805599abeef2495606fb992 |
| delivery-labels.mjs | 97acad1d6b9a386679e19c2d20d86f49ff4f6d4b4c62269ce42f609ba7197968 |
| lan-launch.mjs | 2893e61879ec5ad6ccfb134f11d0803a59f21290a4440817ccaeffb013cc2fff |
| logo-pixels.mjs | 4ebdad4203181b4b27a824d2fccc8d103a69374a71560bbb185f4ce8b45791a4 |
| logo-schema.sql | 870639c04b38983dccd7645fcb528a6dc8f34a8758580020cd79717d3f6cd4e4 |
| logos.mjs | 58cf4853d088af234685edaf98815a2bd74ee6bb8931abb6b83030f5ae51205b |
| management-schema.sql | c6a03ed5d492412415dc03cd62e18b9092f4c339ba86fc69d27118fe0589d21f |
| management.mjs | 108d9ba5c377c9833e4eaf05014ed888daec26dee457f626e64d1f6d970ccf8a |
| mockup-schema.sql | 45d81db219a52eb0ec20a79ea2f6af2cb2c9e93eb554615b3e769f9074523de5 |
| mockups.mjs | d1fb10fc60b52882fef19d5573dcc3598872a612b17bbd4002fabb2da2849a5d |
| package.json | 0d6b450d8755547e2abfdc93435fe9a7a9e38ff63d95a9b132f85395e192c814 |
| rule-auth.mjs | 66fcbf073fb4bb5f58c9998bf8ef08744d324f30d87eb2e77167de5e4e99e732 |
| rule-engine.mjs | 70a2ba75043ddec869e9ae469174d654e59b8d6a7569ce89296e5d9f2eb34092 |
| rule-schema.sql | d3a1269bf16c807c5a3852447b625d986f56a7380d66bf4e4824d81569beb389 |
| run-tests.mjs | 55814c13f1e05116ccd4e7498c944b1d8d621d58fc363b4e2d7485c3c8876559 |
| schema.sql | 3b7fb2416ffa105179042a73c510b9720576fd120f321430388aa93f81f0daaa |
| server.mjs | 761d9becc014c93b6fa18be0b2dcb50ff8719377ed6cf35a501646a8f651a953 |
| smart-background.mjs | ca6aedd59cac62bef339729c33cf41c1d2762f54e11022be0c3c04543fed3f0f |
| start.cmd | 61731ea5854c95d352629b8e4d8c92b98eb9a25ebe9b15f97a13c612df62c705 |
| start.ps1 | 10ba150722002fc5e11081c948d359643e2708fd0fb172662d73a4bd8966d230 |
| storage-management.mjs | 64e4405a1159160915037baf9731ee54e91f6f6206faae23a2a47dd305dc0c46 |
| storage.mjs | c4fc19cbec4dc4b3acd580d8e201abbbf003b9f3746bdd2bc5874850f702b027 |
| surface-colors.mjs | 75f0488169fe2972b462f765286f0002ed5cd9dcb1a63410f05e5be80208df05 |
| target-overrides.mjs | 41ced0b487e8ec46bafb6af5f16fbfa186a01059d511cb678f6b527be2e9cb16 |
| task-products.mjs | a4ffd4a9978b63ccf3203c00445b2167c9ff1bd35a21aaa7ee7a46d00cab01fc |
| template-automation.mjs | 541a341dd8453f250379c05fdf1a214adb371c726b5494f07c530eb59b8aed7e |
| templates.mjs | 2ce1b5398e69eafbc719146e94817bdd5fdae511ddc16252d43377bc5c32a3e7 |
| test-ai.mjs | 3f59d523f9ce666c88a6b7956aa82548c0176beed908b06c27bf084ac83725f9 |
| test-apimart.mjs | ae0206e7434f3c8ffd72493b6a1f813974bb3490461fc1b964010ade665b5fb5 |
| test-automatic-render.mjs | cdd73d6b5f20ea27474a5b1fe420e15615dd9eba1c5f3e03573e5172d4d376c8 |
| test-carrier-color-flow.mjs | c4b1c848de862b209910addd32a174178359bcdde8151cbb698a3e7bab2b57da |
| test-carrier-colors.mjs | 614f46849df50e242132e621001239ec5c0316df39b35e22aaf2ae4f33d023a0 |
| test-carrier-processes.mjs | c1c91ac2fb0e7df4f4b5e17bf7b33f64ae1208a51db1725c083a4ecc8c469b5c |
| test-completion-foundation.mjs | 7ee3332531128c9bbac663c9aced23c8ad6bd2120b19e1ad2e67c15f59099836 |
| test-customer-rounds.mjs | 703f7826e0a32881a0428c100fa1a3740c178823ce8fbdad74e92813d753154b |
| test-geometry.mjs | d16577ddc7cf2a629697c69da883d37e929fc6eb6b7cbdacc7164d09f7e2fb04 |
| test-prelaunch-foundation.mjs | 47446c527e53e9a5e55f2696e90f444205c12365433802e52a3b981866f3742a |
| test-process-choice.mjs | c58a3ad9ffa42410aa4051d9efe6442d2b694cf2aaf5d026625d2cf424907b8f |
| test-smart-background.mjs | 6dc33b1c7ab83b423075770aa76eb545816015621f1f446373c545347116b591 |
| test-step2.mjs | 9ad3f47114d1fc776fb2ef1054ab6dbf0af402a3c49ccb1ffc1d1cbbc1b1b2b8 |
| test-step3.mjs | 615d8d5b112e7788c3ea44ccf0ef93bba0212347165c2589f2fabdaaa8ec6280 |
| test-step4.mjs | 3ec019570c79349433a60342c867f524f89d7a0da629a51d6632e724f8991688 |
| test-step5.mjs | 7ac9503021f5c46e6fb40de5d2a59fff984f32355ccca3c06a7655ceb9f2a69a |
| test-step6a.mjs | 67ff9a2647e037baa35578b170d18c450a0c5782b2d28b36b078ad5c453cbb01 |
| test-step6a1.mjs | cdf0113c195c46d925d809cdb8cafc29b0095ad05d2b94541d4dfe86908f9cba |
| test-step6a2.mjs | 5ae680372dd6d55de2ebdeb4a0809a3551312afd7d709c1eb1acd045997d0ae2 |
| test-step6b.mjs | e6b91f6798069e1073ef0531e85be7239ecb42130a3714d90900be5ef72e6d59 |
| test-surface-delivery-flow.mjs | 9cb60872b9a1995ed6a7f94ccb4659db75da3e2a7072023bd2603d8404ac2635 |
| test-surface-delivery.mjs | 14dd89583fe4f092f660ed7b9b13b54e9d155690b79b17f3e808bdafdc07a60f |
| test-transparent-masters.mjs | d70805a1f2f1981bb7762798e31e79062f8f6a5e2f68350d5af69a7850e1850c |
| test-transparent-resources.mjs | c60b6a027579dc338cf6623be569cf364618b5e2b02eaa688e07bf15554e43da |
| test.mjs | 19b63726dbd78957041dcf1d666539bcecabf677fe5987879bb5c6e458bf4b12 |
| transparent-masters.mjs | 433794b3c585aa14c912bd9fda5ff9d478b1c213197cbe69b27a3d29bdcc5d46 |
| validate-step6b.ps1 | fd115a4821efe6d0fd5d89f6f32022788cb5a072a69fc22c8febdb1a5d7fe114 |
| zip.mjs | e65dc49d7083fb2e366e7850706f3a91aa2c3658d67607fb09b201fd07c8d723 |
| 双击启动AI效果图智能助理.cmd | 61731ea5854c95d352629b8e4d8c92b98eb9a25ebe9b15f97a13c612df62c705 |
| 本机验证Step6B.cmd | 6f8e11fceac4183ea8f0ed7b58922ac30a2a1657e52cc361c55cdccf0928fa56 |
| public/acceptance-bootstrap.js | 3fab2039bcab90345a95161839d6e11cc8b506d6368ae78388898246b12234f4 |
| public/acceptance-ui.js | ef82be3d1f97fbce83a7f6781f124b2a5efd49767977df9af3095a84a0a69c97 |
| public/acceptance.css | 9a39e3585f432216dc65e9f32c9402dbcdeae972ff8f119edb75a650c32be3be |
| public/acceptance.html | 3baca56efc79c70507d04df4812ac81edb2293189b0467043900edbfed2c63a7 |
| public/additions.css | 3adfdd7e5dcfac33de5be9dd1d94e6945c40ec840b02c06cec4e5465bf9f3126 |
| public/ai-ui.js | de2263e299d86bf7087eaaae124163aae656fec1e0882a99c04f66f368d87b15 |
| public/app.js | cf9d7befb1fd1dfe2f7ddf5ace121a18ca947aa7643e890d583417720fc82bde |
| public/auto-placement.js | f1c92ec7d3318da4ce8a49d0c3562f40be0767c3e1134f27a46e43fa83ede2b7 |
| public/automatic-rounds-ui.js | 9bcdc3f3415c5c055da2e5f646c6c36cae2a83bf7ea221752f45073aa947a94b |
| public/automatic-ui.js | 80662b88e4d72929535b03af22d983b3d560e9c1325c12f8b1b76e97b5016eb3 |
| public/batch-ui.js | 0529d7b056993dd0fcf86a0a782b62be22c5f2b97aa35bc6d63d90c0ad2eb76a |
| public/batch.css | eaaaddc78d0592e6df5f593a997a94e532660a439c014ad3584321495c722507 |
| public/favicon.svg | b196164aba46f8533406d39bc3850f760817349544f5c17250ff2efd5e52e9be |
| public/index.html | 39d84add3a2eab19d0cf1ff057a2c9aedb8e6509e851f82357b7583b1723137d |
| public/logo-editor.js | e915179e8fba354ecda98412049ed9e74effd19df25cbb1a235f41364fe7fa29 |
| public/logo.css | a2f006423ee14f1dde16ab1eb0909e3d276e211f205051601e49c2f48c2f69eb |
| public/management-ui.js | e84b5045b68689512cb90ce7f52728b3e4fcfe588fe6c6c2d8940473f299ce9d |
| public/management.css | 2c3b8a801db9534d96c700a6737a5c413831f40a8de5dfe55d7eb11309429dce |
| public/mockup-geometry.js | 570e73887009c8cfbfbd98f3bffe3b7000840631d932b3d6a077a9673fa551f9 |
| public/placement-transform.js | 6b9abf5d492adfc0bebf2b579c350a9f46ebe3d3c1eaa366fae979d982aa3698 |
| public/rule-ui.js | c67c99ffe975bf3bc387a295093f09d89e123cdd12298eb28439b18cc7cf427d |
| public/rule.css | 208f5f98ce7dfd599f0076a470c413bec25ac311b7791b1fca841b70ee58aa30 |
| public/sku-management.js | 921d21bb2c1b65a7da26ac7f59d1961031db967a490ca3016688d4aadb67e94e |
| public/style.css | 5d832e3686a162bcadd2e77dad44d3df3a1b6cb7d1cdc55c720f206ed0157ee3 |
| public/target-options.js | 020d70e1ff61923bbf546f1c1052c9c5d11cccd2a47bfaba94c6d4d71dcea44a |
| public/task-additions.js | 0700a4316cd10cb27ba2411a7c0f687fe0f32e8ce78c03da030cd83727ea0b76 |
| public/template-automation-ui.js | b434029ee2996c86855ef24c4b671b6f7baceae1c6ad6e61b0147e55f2212fc3 |
| public/template-editor.js | 29033cb7c0359ac682153d23a405a0a35f9a1a35c74cce9515b699e18a8580d0 |
| public/template.css | 9f8ae6df2fb3e44c053071c7c9d88a007b8159a460f23af82432dc03bc857c96 |
| public/transparent-ui.js | 346d04488c89923c98f3109bb4b62f3b8207097795b449dfe847e5e9e930b5af |
| public/transparent.css | 1a64e272a8053795def286e770d535b5b4ac7810052640f5903235d7a4e0b49d |
| public/workspace.css | d678e67ac8dd1a3355b14410fc322c35ba768a28dc2baa8391b345da9179648d |
| public/workspace.js | 835836612d4c53d896f4ef8b47929b29a0a13a1927bb8705b99db2aafba632d5 |
| public/zone-geometry.js | 10780204c3c482397c652862ea3320faa86e0ed76b7038546dbd6a6f787b2943 |
| seed/E0001.png | 43aafeb03fb202e5f66c59b4cdad45a1b5cc5c769972d397707517b973e35cdc |
| seed/F0021.jpg | 2174c28407af6586dfd672fd7b94225e831cb611cfa056b93a31bfb177887b4f |
| seed/L0033.jpg | 91661de9e19a6c7116d29af2e0bb35c040375178587b4069a2499c90fdf6ffa8 |
| seed/L0039.jpg | 05aef136ccc18b0ba5c5fe467c70452137fd88b9642f38cae850d11344def1a9 |
| seed/L0048.png | 5df90b4ab3c2919f3519eb5e009bd8fbce7ca30e5bd43aa06f8cce1d8d91eb07 |
