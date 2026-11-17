import { describe, expect, it } from "vitest";
import { isSameOriginWrite } from "@/lib/github/request-origin";

function request(headers: Record<string, string>, url = "http://localhost:3000/api/remediate") {
  return new Request(url, { method: "POST", headers });
}

describe("isSameOriginWrite", () => {
  it("allows same-origin JSON browser writes", () => {
    expect(
      isSameOriginWrite(
        request({
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
  });

  it("allows JSON writes with no Origin header", () => {
    expect(isSameOriginWrite(request({ "content-type": "application/json" }))).toBe(true);
  });

  it("rejects cross-site fetches", () => {
    expect(
      isSameOriginWrite(
        request({
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);
  });

  it("rejects non-JSON content types", () => {
    expect(
      isSameOriginWrite(
        request({
          "content-type": "text/plain",
          origin: "http://localhost:3000",
        }),
      ),
    ).toBe(false);
  });

  it("rejects Origin that matches neither AUTH_URL nor the request host", () => {
    const previous = process.env.AUTH_URL;
    process.env.AUTH_URL = "http://localhost:3001";
    try {
      expect(
        isSameOriginWrite(
          request({
            "content-type": "application/json",
            origin: "http://localhost:9999",
          }),
        ),
      ).toBe(false);
      expect(
        isSameOriginWrite(
          request({
            "content-type": "application/json",
            origin: "http://localhost:3000",
          }),
        ),
      ).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AUTH_URL;
      else process.env.AUTH_URL = previous;
    }
  });
});
