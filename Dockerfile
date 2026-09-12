FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY main.go catalog_linux.go ./
COPY player ./player
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o /radio .

FROM alpine:3.23
RUN apk add --no-cache ca-certificates ffmpeg util-linux
COPY --from=build /radio /usr/local/bin/radio
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/radio"]
