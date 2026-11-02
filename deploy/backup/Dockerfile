FROM postgres:17-alpine
RUN apk add --no-cache rclone openssl curl
COPY *.sh /scripts/
RUN chmod 755 /scripts/*.sh
CMD ["/scripts/schedule.sh"]
