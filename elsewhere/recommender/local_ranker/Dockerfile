# CPU runtime and pinned model are read-only host mounts prepared with Conda.
FROM debian:bookworm-slim
COPY elsewhere/recommender/local_ranker/ /app/
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/tmp
USER 65532:65532
ENTRYPOINT ["/runtime/bin/python", "/app/service.py"]
