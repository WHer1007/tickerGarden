# V1 Pons IPFS 图片上传研究

观察日期：2026-09-05（Asia/Shanghai）。本记录只做公开页面、公开 JavaScript chunk 和公开仓库的读取；没有向 Pons 或任何 IPFS endpoint 发起上传/POST。

## 结论

当前 `https://www.ponsfamily.com/launchpad/create` 的前端要求用户先确认“selected artwork will be moderated and uploaded to public IPFS”，然后上传图片；成功后得到一个 `ipfs://...` URI。前端把这个 URI 直接作为 launch 参数的 `logo`（当前 v2）或 `image`（v1）传给链上 `launchToken`。在新鲜页面引用的 chunk 中没有发现“再上传 metadata JSON 并取得 metadata CID”的客户端步骤，也没有发现客户端调用 `tokenURI()` 来生成 URI。因此，当前可验证的实际路径是 `image file -> image CID/URI -> launchToken`，而不是已证实的 `imageCID -> metadataJSONCID -> tokenURI`。

## 可复现的页面和 chunk 证据

- 页面：[pons launch create](https://www.ponsfamily.com/launchpad/create)。2026-09-05 读取到 Next.js immutable chunks；页面默认选择 v2。HTML 的文件 input 声明 `accept="image/png,image/jpeg,image/webp,image/gif"`，但实际 v2 handler 的 MIME Set 只有 `image/jpeg`、`image/png`、`image/webp`。
- 当前 v2/v1 业务代码 chunk：[1ncfnauk9edc7.js](https://www.ponsfamily.com/_next/static/immutable/chunks/1ncfnauk9edc7.js)。chunk 中的常量是 `https://pons-vercel-data-gateway.ozzy-6de.workers.dev/public/ipfs/image`（去空格后若为空才 fallback 到 `/api/ipfs/image`）。v2 handler 的请求顺序是：选文件 -> 检查确认 checkbox -> 检查 MIME -> 检查 `0 < size <= 5242880` -> `FormData.append("image", file)` -> `fetch(K, {method: "POST", body: form})` -> 解析 JSON -> 要求 `response.uri` 且通过 `isValidIpfsUri` -> 保存该 URI 并用 gateway 预热缩略图。此处 POST 仅为代码观察，未执行。
- 同一 chunk 的 v1 分支使用 `fetch("/api/ipfs/image", {method: "POST", body: form})`，同样要求 `uri` 是有效 IPFS URI；其上传限制检查也是 5 MiB。v1 UI 错误文案包含 GIF，但该分支实际 MIME Set 也只接受 PNG/JPEG/WebP，存在 UI 声明与 handler 的不一致。
- 同一 chunk 的 URI 辅助函数把裸 CID 的直接预览映射为 `https://gateway.pinata.cloud/ipfs/{CID}`；普通预览映射为站内 `/api/ipfs/content/{CID}?variant=card|compact`，原图则映射到 gateway worker 的 `/public/ipfs/content/{CID}`。这是网关映射证据，不是 Pinata 作为上传或 pinning 服务的证明。
- 对两个可读 GET endpoint 做了无副作用探测：`GET https://www.ponsfamily.com/api/ipfs/image` 返回 HTTP 405；`GET https://pons-vercel-data-gateway.ozzy-6de.workers.dev/public/ipfs/image` 在 8 秒内超时。没有把这些结果解释为上传失败，因为没有执行规定的 POST。

## provider、鉴权、pinning 与持久性

可观测 provider 只有一个 Pons 自有 gateway worker hostname：`pons-vercel-data-gateway.ozzy-6de.workers.dev`。[配置 chunk 1tflc6hg797rv.js](https://www.ponsfamily.com/_next/static/immutable/chunks/1tflc6hg797rv.js) 还包含服务端配置名 `PINATA_JWT`、`PINATA_GATEWAY_URL`、`PINATA_GATEWAY_TOKEN` 和 `NEXT_PUBLIC_IPFS_GATEWAY_URL`，但公开前端没有 JWT、API key、Authorization header 或 provider response schema；不能据此断言实际上传 provider 是 Pinata。客户端请求本身是 browser multipart 请求，没有可见的用户签名或钱包鉴权；moderation、rate limit、pinning、重复 CID 行为、失败重试、超时和保留 SLA 均未公开证实。

IPFS 的 CID 标识内容；相同文件采用不同分块、编码或 CID 参数时也可能生成不同 CID。CID 本身不保证某个节点持续 pin。IPFS 官方关于持久性的说明见 [Persistence on IPFS](https://docs.ipfs.tech/concepts/persistence/)，NFT 数据建议见 [Best practices for storing NFT data](https://docs.ipfs.tech/how-to/best-practices-for-nft-data/)。因此 V1 若采用 IPFS，必须把“上传成功”“至少一个受控 pin 服务确认 pin”“可通过两个受控 gateway 读取”作为不同状态记录，不能把 HTTP 201 或返回 CID 当作永久可用的证明。

## 与 TickerGarden 当前后端的差异

当前实现见 [launch-metadata.ts](/Users/dear/Documents/code/TickerGarden/services/backend-api/src/launch-metadata.ts)。它不是 IPFS：

- 接收 `POST /launch-metadata` 的 JSON，图片是 PNG/JPEG/WebP data URI；原始图片上限 2 MiB，请求体上限 3 MiB，且校验 magic bytes（[第 6-10 行](/Users/dear/Documents/code/TickerGarden/services/backend-api/src/launch-metadata.ts:6) 和 [第 65-78 行](/Users/dear/Documents/code/TickerGarden/services/backend-api/src/launch-metadata.ts:65)）。
- 图片以 SHA-256 文件名写入配置的 filesystem directory，metadata JSON 也以 SHA-256 文件名写入；返回 HTTPS `metadataURI`，GET 返回带 `immutable` cache-control 的本地 origin URL（[第 132-158 行](/Users/dear/Documents/code/TickerGarden/services/backend-api/src/launch-metadata.ts:132)）。
- 这条路径没有 CID、pinning 或 provider API；其 JSON 字段包含 `name`、`symbol`、`description`、可选 `image`/`external_url` 和 `properties`，与 Pons 前端当前把 image URI 直接放入 launch 参数的行为也不相同。

## 建议的 V1 集成步骤（本次仅记录，尚未实现）

1. 先确定并记录一个受控上传 provider；在没有明确 provider 合同、凭证注入方式、moderation 结果和 pin 确认前，保持现有 filesystem 实现，不把 Pinata 配置名当作凭证或 provider 承诺。
2. 前端保持图片预检（允许类型、明确大小上限、拒绝空文件），向 TickerGarden 的后端上传；后端用 provider SDK/HTTPS API 上传图片，验证返回的 CID/URI，并把 `imageCID`、provider request id、pin 状态和重试信息写入可审计记录。不要让浏览器接触 provider secret。
3. 以规范化 JSON 生成 metadata（保留现有 `name`、`symbol`、`description`、`external_url` 和 `properties`，将图片引用改为 `image: ipfs://<imageCID>`），固定 UTF-8、字段顺序/序列化规则后上传 JSON，得到 `metadataJSONCID`。metadata 的 `image` 应保持 canonical `ipfs://`，展示层再转换 gateway URL。
4. 本项目 Factory 的创建参数已经是 `metadataURI`，并由 [TickerMemeTokenV1.metadataURI()](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/modules/TickerMemeTokenV1.sol:70) 返回，因此应提交 `metadataURI = ipfs://<metadataJSONCID>`，无需模仿 Pons 改为仅存图片 URI，也不应把接口误称为 ERC-721 的 `tokenURI()`。前端 [publishLaunchMetadata](/Users/dear/Documents/code/TickerGarden/apps/web/src/create/metadata.ts:9) 目前仅接受同源 `/launch-metadata/<SHA256>.json` URL；接入时必须同步增加严格的 IPFS URI/CID 验证，以及展示层的 gateway 解析，不能只替换后端返回值。
5. 依次验证 image CID、metadata CID 在至少两个受控 gateway 可读，记录 `imageCID -> metadataJSONCID -> metadataURI` 映射；钱包签名交易只在这些读取和 pin 检查通过后发起。失败时保留 CID 和可重试状态，避免重复上传导致无法关联。
6. 增加可观测性和恢复策略：provider 超时/5xx 指数退避且有上限，pin 未确认不进入 launch-ready，gateway 读取失败触发告警；密钥只在服务器 secret store 中，轮换不改变已发布 CID。

## 未知项与边界

公开页面/chunk 没有给出图片重编码、尺寸像素限制、metadata JSON schema、provider 的 pin 保证、认证方式、quota、retry-after、删除策略或永久保存期限。官方公开仓库 [ponsdotdev/ponsfamily](https://github.com/ponsdotdev/ponsfamily) 是合约源码/ABI 仓库；其 README 描述 token 的链上 logo、description、socials，但没有公开图片/metadata 上传实现。上述缺失项必须通过 Pons 的正式接口合同或可授权的受控测试补齐。
