import os

from dotenv import load_dotenv

from convex import ConvexClient

load_dotenv(".env.local")
CONVEX_URL = os.getenv("CONVEX_URL")

client = ConvexClient(CONVEX_URL)

print(client.query("metadata:get"))

for tasks in client.subscribe("metadata:get"):
    print(tasks)
    # this loop lasts forever, ctrl-c to exit it