import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
print("Working directory:", os.getcwd())
print("Environment file loaded:", bool(os.getenv("SUPABASE_URL")))
print("Project URL:", os.getenv("SUPABASE_URL"))
print("Key prefix:", (os.getenv("SUPABASE_KEY") or "")[:12])

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")

if not url or not key:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY in .env")

supabase = create_client(url, key)

print("\n--- Testing Apex AML database ---")

for table in ["aml_transactions", "ml_predictions"]:
    try:
        response = (
            supabase.table(table)
            .select("transaction_id")
            .limit(5)
            .execute()
        )

        print(f"\nTable: {table}")
        print(f"Rows returned: {len(response.data)}")
        print(f"Sample: {response.data[:2]}")

    except Exception as e:
        print(f"\nTable: {table}")
        print(f"Error: {e}")