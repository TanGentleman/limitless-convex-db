import os

from dotenv import load_dotenv
from convex import ConvexClient

def get_client():
    load_dotenv()
    backend_url = os.getenv("CONVEX_URL")
    if not backend_url:
        raise ValueError("CONVEX_URL is not set")
    return ConvexClient(backend_url)

def main():
    client = get_client()
    print(client.mutation("sync:syncLimitless"))

if __name__ == "__main__":
    main()