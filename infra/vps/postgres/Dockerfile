FROM postgres:17-alpine
COPY docker-entrypoint-tg.sh /usr/local/bin/docker-entrypoint-tg.sh
COPY init-environment.sh /docker-entrypoint-initdb.d/10-init-environment.sh
ENTRYPOINT ["docker-entrypoint-tg.sh"]
CMD ["postgres", "-c", "ssl=on", "-c", "ssl_cert_file=/var/lib/postgresql/server.crt", "-c", "ssl_key_file=/var/lib/postgresql/server.key", "-c", "password_encryption=scram-sha-256"]
