FROM public.ecr.aws/gravitational/teleport-distroless:18.7.3 AS tp

FROM debian:bookworm-slim
RUN useradd -m -s /bin/bash agentwork && mkdir -p /var/lib/teleport && chown -R agentwork /var/lib/teleport
COPY --from=tp /usr/local/bin/teleport /usr/local/bin/teleport
ENTRYPOINT ["/usr/local/bin/teleport", "start"]
