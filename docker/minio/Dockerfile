# MinIO Community is source distributed. Build an exact upstream revision locally.
FROM golang:1.24.8-alpine3.22 AS build
RUN apk add --no-cache git ca-certificates
WORKDIR /src
RUN git init && git remote add origin https://github.com/minio/minio.git \
 && git fetch --depth=1 origin 7aac2a2c5b7c882e68c1ce017d8256be2feea27f \
 && git checkout --detach FETCH_HEAD
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/minio .
FROM alpine:3.22
RUN apk add --no-cache ca-certificates && mkdir /data && chown 10001:10001 /data
COPY --from=build /out/minio /usr/local/bin/minio
USER 10001:10001
VOLUME /data
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
