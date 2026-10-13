import json
import os
import sys
import urllib.request
import uuid
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("HERACLES_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
LOCAL_SUPABASE_URL = os.environ["HERACLES_SMOKE_API_URL"].rstrip("/")
LOCAL_SUPABASE_KEY = os.environ["HERACLES_SMOKE_ANON_KEY"]
FAKE_SUPABASE_URL = "https://heracles-smoke.local"
AUTH_STORAGE_KEY = "sb-heracles-smoke-auth-token"


def describe_url(url):
    # Diagnostics keep the endpoint but drop query strings and fragments, which can carry tokens.
    parts = urlsplit(url)
    if not parts.netloc:
        return url
    return f"{parts.scheme}://{parts.netloc}{parts.path}"


def format_diagnostics(browser_errors, failed_responses):
    details = []
    if browser_errors:
        details.append("Browser smoke emitted runtime errors:\n" + "\n".join(browser_errors))
    if failed_responses:
        details.append("Failed HTTP responses:\n" + "\n".join(failed_responses))
    return "\n".join(details)


def create_test_session():
    email = f"browser-smoke-{uuid.uuid4().hex}@example.test"
    payload = json.dumps({
        "email": email,
        "password": "HeraclesBrowserSmoke42!",
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{LOCAL_SUPABASE_URL}/auth/v1/signup",
        data=payload,
        method="POST",
        headers={
            "apikey": LOCAL_SUPABASE_KEY,
            "Authorization": f"Bearer {LOCAL_SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        session = json.load(response)

    required = {"access_token", "refresh_token", "user"}
    missing = sorted(required.difference(session))
    if missing:
        raise RuntimeError(f"Local Supabase signup did not return a session; missing: {', '.join(missing)}")
    return session


def main():
    session = create_test_session()
    browser_errors = []
    failed_responses = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context()

        def proxy_local_supabase(route):
            request = route.request
            target_url = f"{LOCAL_SUPABASE_URL}{request.url[len(FAKE_SUPABASE_URL):]}"
            headers = dict(request.headers)
            headers.pop("host", None)
            response = route.fetch(url=target_url, headers=headers)
            route.fulfill(response=response)

        context.route(f"{FAKE_SUPABASE_URL}/**", proxy_local_supabase)
        page = context.new_page()

        def record_console(message):
            if message.type != "error":
                return
            # "Failed to load resource" messages omit the URL from their text; it lives in the location.
            source = message.location.get("url") if message.location else None
            suffix = f" ({describe_url(source)})" if source else ""
            browser_errors.append(f"console error: {message.text}{suffix}")

        def record_response(response):
            if response.status >= 400:
                failed_responses.append(
                    f"HTTP {response.status} {response.request.method} {describe_url(response.url)}"
                )

        page.on("pageerror", lambda error: browser_errors.append(f"pageerror: {error}"))
        page.on("console", record_console)
        page.on("response", record_response)

        try:
            # Real signed-out startup through the same HTTP server used by local development.
            page.goto(BASE_URL, wait_until="domcontentloaded")
            expect(page.locator("#signed-out")).to_be_visible(timeout=20_000)
            expect(page.locator("#google-sign-in")).to_be_visible()
            expect(page.locator("#google-sign-in")).to_be_enabled()

            # Seed a genuine local Supabase session; no application-side auth bypass is used.
            page.evaluate(
                "([key, value]) => localStorage.setItem(key, value)",
                [AUTH_STORAGE_KEY, json.dumps(session)],
            )

            # Direct URL-backed authenticated startup must initialize the requested page.
            page.goto(f"{BASE_URL}/?page=settings", wait_until="domcontentloaded")
            expect(page.locator("#signed-in")).to_be_visible(timeout=20_000)
            expect(page.locator('[data-page-panel="settings"]')).to_be_visible()

            # Exercise a core rendered workout flow against the disposable local database.
            page.goto(BASE_URL, wait_until="domcontentloaded")
            start_button = page.locator("#start-session")
            expect(start_button).to_have_text("Create Session", timeout=20_000)
            start_button.click()

            add_gym_button = page.get_by_role("button", name="+ Add new gym")
            expect(add_gym_button).to_be_visible(timeout=10_000)
            add_gym_button.click()
            page.locator('input[placeholder="Enter gym name…"]').fill("Browser Smoke Gym")
            page.get_by_role("button", name="Add Gym").click()

            empty_workout_button = page.get_by_role("button", name="Start empty workout")
            expect(empty_workout_button).to_be_visible(timeout=10_000)
            empty_workout_button.click()

            expect(page.locator("#live-session-container .live-session-title")).to_have_text(
                "Live Workout", timeout=20_000
            )
            expect(page.locator("#live-session-container .live-empty-title")).to_have_text("No exercises yet")
            page.wait_for_url("**/?page=live-session", timeout=20_000)

            # Clean up through the real rendered cancellation workflow.
            page.locator("#live-session-container .cancel-session-button").click()
            confirm_cancel = page.locator("#confirm-cancel-workout-button")
            expect(confirm_cancel).to_be_visible()
            confirm_cancel.click()
            expect(start_button).to_have_text("Create Session", timeout=20_000)
        except Exception:
            # A failed expectation would otherwise hide the browser errors that explain it.
            diagnostics = format_diagnostics(browser_errors, failed_responses)
            if diagnostics:
                print(diagnostics, file=sys.stderr)
            raise

        browser.close()

    if browser_errors:
        raise RuntimeError(format_diagnostics(browser_errors, failed_responses))

    print("Browser smoke passed: signed-out startup, authenticated routing, workout start, and cancellation.")


if __name__ == "__main__":
    main()
