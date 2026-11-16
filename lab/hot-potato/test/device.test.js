// The device line in the report: the owner's desktop Chrome on Windows was "device: other" in v1.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deviceInfo, micKind } from "../public/device.js";

const ownerAgent = readFileSync(new URL("./fixtures/hearing-report-1.txt", import.meta.url), "utf8").match(/^device: other; (.*)$/m)[1];

describe("which device the page is on", () => {
  it("names the owner's desktop Chrome on Windows (from his report)", () => {
    expect(deviceInfo(ownerAgent)).toMatchObject({ kind: "desktop", os: "Windows", browser: "Chrome 157", label: "desktop (Windows, Chrome 157)" });
  });

  it("tells phones, tablets and desktops apart", () => {
    const pixel = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
    expect(deviceInfo(pixel)).toMatchObject({ kind: "phone", os: "Android", browser: "Chrome 157" });
    const tab = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";
    expect(deviceInfo(tab).kind).toBe("tablet");
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1";
    expect(deviceInfo(iphone)).toMatchObject({ kind: "phone", os: "iOS", browser: "Safari 19", ios: true });
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15";
    expect(deviceInfo(mac, null, 0)).toMatchObject({ kind: "desktop", os: "macOS", browser: "Safari 19" });
    expect(deviceInfo(mac, null, 5)).toMatchObject({ kind: "tablet", os: "iPadOS" }); // an iPad asking for the desktop site
    const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";
    expect(deviceInfo(edge)).toMatchObject({ kind: "desktop", browser: "Edge 157" });
    const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
    expect(deviceInfo(firefox)).toMatchObject({ kind: "desktop", os: "Linux", browser: "Firefox 140" });
  });
});

describe("microphone labels in the report", () => {
  it("reduces a device's own name to a generic kind", () => {
    expect(micKind("Microphone Array (Realtek(R) Audio)")).toBe("built-in");
    expect(micKind("Headset Microphone (Jabra Evolve 65)")).toBe("headset");
    expect(micKind("Logitech BRIO")).toBe("webcam");
    expect(micKind("Yeti Stereo Microphone")).toBe("usb");
    expect(micKind("Line In")).toBe("other");
    expect(micKind("")).toBe("unnamed");
  });
});
