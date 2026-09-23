FROM postgres:17-alpine
COPY docker-entrypoint-tg.sh /usr/local/bin/docker-entrypoint-tg.sh
COPY init-environment.sh /docker-entrypoint-initdb.d/10-init-environment.sh
ENTRYPOINT ["docker-entrypoint-tg.sh"]
CMD ["postgres", "-c", "ssl=on", "-c", "ssl_cert_file=/var/lib/postgresql/server.crt", "-c", "ssl_key_file=/var/lib/postgresql/server.key", "-c", "password_encryption=scram-sha-256", "-c", "shared_preload_libraries=pg_stat_statements", "-c", "pg_stat_statements.track=top", "-c", "pg_stat_statements.max=5000", "-c", "pg_stat_statements.save=on", "-c", "compute_query_id=on", "-c", "track_io_timing=on", "-c", "log_min_duration_statement=1000", "-c", "log_parameter_max_length=0", "-c", "log_parameter_max_length_on_error=0", "-c", "log_line_prefix=%m [%p] db=%d user=%u app=%a "]
