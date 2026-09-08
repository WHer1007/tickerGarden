# Services

项目唯一后端为 [backend-go](./backend-go/README.md)。所有生产 API、索引和后台任务均从同一 Go module 构建，由不同命令按职责运行。

| 路径 | 职责 |
| --- | --- |
| `backend-go/cmd/` | API、content-worker、索引、投影、维护、结算、Treasury 等 Go 进程入口 |
| `backend-go/internal/` | 业务实现、存储、链上校验与测试 |
| `backend-go/openapi/` | Read API 契约与供前端使用的生成客户端 |
| `backend-go/testsupport/` | 仅开发和测试使用的独立参考算法，无服务启动入口 |

从根目录执行 `npm run build:offchain` / `npm run test:offchain`，构建/测试 Go 后端与部署工具。`npm run check:backend-contracts` 核对 API、事件及独立计算夹具，需先构建 Solidity 产物并安装前端锁定依赖。

旧 TypeScript API、Indexer、maintenance runner、Treasury root 服务已移除。前端 TypeScript、部署脚本和测试参考算法继续保留。Go 服务能否上线仍需按实际功能完成配置、集成与目标环境验收；语言统一不代表上线验收完成。
