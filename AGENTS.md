# PixelIt.API agent guidance

This repository contains the Node.js/Express bitmap API service, not the firmware's
device API. Read `README.md` and `package.json` for configuration and runtime requirements.

## Shared project requirements

Smooth device animations and ESP8266 memory compatibility are hard requirements.
Evaluate changes against the smallest supported device, not just ESP32 or a desktop.
Keep device-bound payloads, frame counts, dimensions, request frequency and concurrent
transfers bounded. Avoid unnecessary polling, retries or duplicate transfers that
consume firmware heap or interrupt playback. Do not raise firmware limits implicitly.
Consult the target firmware version's `include/AnimationLimits.h` and
`docs/development.md`; avoid copying limits here where they can become stale.
Builds and host tests alone do not prove smooth playback or safe device RAM usage.
For changes affecting device load, report whether ESP8266 timing and peak-memory
validation was performed, and identify any remaining gap.

## Related repositories

- [PixelIt](https://github.com/pixelit-project/PixelIt): device firmware and device-side HTTP/MQTT/WebSocket contracts.
- [PixelIt.Docs](https://github.com/pixelit-project/PixelIt.Docs): project and user documentation.
- [node-red-contrib-pixelit](https://github.com/pixelit-project/node-red-contrib-pixelit): Node-RED control nodes.
- [PixelIt.WebUI](https://github.com/pixelit-project/PixelIt.WebUI): device WebUI.
- [PixelIt.API](https://github.com/pixelit-project/PixelIt.API): bitmap API service, separate from the device API.

Inspect relevant companion code when changing shared formats or behavior. Preserve
compatibility with existing clients and supported firmware; explicitly identify
required companion changes and external documentation updates. Report unavailable
sources rather than assuming their behavior.

## Service conventions and validation

- Preserve endpoint paths, response envelopes, bitmap encoding and client-facing
  errors used by firmware, WebUI and Node-RED.
- Keep device-consumed responses bounded and avoid unnecessary response fields or
  copies. Consider payload size on the ESP8266 as well as server resource usage.
- Validate input and keep database queries parameterized. Preserve rate limiting,
  proxy trust and telemetry access controls; never log tokens or credentials.
- Keep caches and external-service retries bounded. Handle dependency failures
  without unbounded work or incompatible response changes.
- For code changes run `npm test`; add focused regression coverage for changed
  contracts or validation. Distinguish mocked tests from real integration checks.
- Keep README environment variables and deployment guidance aligned with behavior.
  Documentation-only edits do not require service tests. Report checks and gaps.
