from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8090"))
    uvicorn.run("mlops_backend.app:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
