"""Verify AI Provider config & connectivity to modelink API."""
import httpx
from windup_framework.config.provider import AIProviderSettings

s = AIProviderSettings()
print("=== AI Provider Config ===")
print(f"  Base URL:    {s.normalized_base_url}")
print(f"  API Key:     {s.api_key[:16]}...{s.api_key[-8:]}")
print(f"  Model:       {s.model or '(not set - using per-provider defaults)'}")
print(f"  Timeout:     {s.timeout}s")
print(f"  Max Retries: {s.max_retries}")
print(f"  Provider:    {s.provider}")
print()

# Quick connectivity test
try:
    resp = httpx.get(
        f"{s.normalized_base_url}/models",
        headers={"Authorization": f"Bearer {s.api_key}"},
        timeout=10,
    )
    if resp.status_code == 200:
        models = resp.json().get("data", [])
        print(f"API Connectivity: OK ({len(models)} models available)")
        print("Top models:")
        for m in models[:8]:
            print(f"  - {m.get('id', '?')}")
    else:
        print(f"API returned: {resp.status_code} {resp.text[:200]}")
except Exception as e:
    print(f"Connectivity test failed: {e}")
