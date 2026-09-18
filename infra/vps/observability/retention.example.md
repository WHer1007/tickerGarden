# 日志留存部署建议（未应用）

当前日志改动不自动重启容器或更改journald。部署时先确认磁盘预算和故障排查所需保留期，再应用：

```yaml
# 对每个现有 Compose service 合并，不替换 service 的其他配置。
logging:
  driver: json-file
  options:
    max-size: "20m"
    max-file: "5"
```

变更仅在容器重建时生效，应按测试→生产部署顺序执行，不为日志设置临时中断生产。

```ini
# /etc/systemd/journald.conf.d/tickergarden-retention.conf
[Journal]
Storage=persistent
SystemMaxUse=512M
SystemKeepFree=1G
MaxRetentionSec=14day
```

以上为建议起点，不是已验收容量。核验日志磁盘实际用量、错误爆发时轮转、各服务stdout/stderr、独立collector和留存平台的权限。应用重启前确认没有活跃资金操作。外部日志采集配置需要选定平台；不要把Lark当作完整日志存储。
