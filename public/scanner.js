(() => {
  let scanStream = null;
  let scanActive = false;
  let scanDetector = null;

  function setScanStatus(msg) {
    const el = document.querySelector("#scanStatus");
    if (!el) return;
    el.textContent = msg || "";
  }

  function normalizeScanValue(value) {
    return String(value || "").trim().toUpperCase();
  }

  function findApparatusFromScan(rawValue) {
    const sel = document.querySelector("#apparatus");
    if (!sel) return null;
    const cleaned = normalizeScanValue(rawValue);
    const matches = cleaned.match(/[A-Z]-\d+/g);
    const candidates = matches?.length ? matches : [cleaned];
    const options = Array.from(sel.options || []);
    for (const candidate of candidates) {
      const option = options.find(
        (opt) =>
          normalizeScanValue(opt.value) === candidate ||
          normalizeScanValue(opt.textContent || "") === candidate ||
          normalizeScanValue(opt.textContent || "").includes(candidate)
      );
      if (option) return option.value;
    }
    return null;
  }

  async function startScanner({ onSelect, onStatus }) {
    if (!("BarcodeDetector" in window)) {
      setScanStatus("Barcode scanning not supported on this device.");
      onStatus?.("Barcode scanning not supported on this device.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanStatus("Camera access is not available.");
      onStatus?.("Camera access is not available.");
      return;
    }

    const backdrop = document.querySelector("#scanBackdrop");
    const video = document.querySelector("#scanVideo");
    if (!backdrop || !video) return;

    scanDetector =
      scanDetector ||
      new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "codabar"] });
    scanActive = true;
    backdrop.classList.add("show");
    backdrop.setAttribute("aria-hidden", "false");
    setScanStatus("Starting camera…");

    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      video.srcObject = scanStream;
      await video.play();
      setScanStatus("Scanning…");
      requestAnimationFrame(() => scanLoop({ onSelect, onStatus }));
    } catch (err) {
      setScanStatus(`Camera error: ${err?.message || err}`);
      onStatus?.(`Camera error: ${err?.message || err}`);
      stopScanner();
    }
  }

  function stopScanner() {
    scanActive = false;
    const backdrop = document.querySelector("#scanBackdrop");
    const video = document.querySelector("#scanVideo");
    if (backdrop) {
      backdrop.classList.remove("show");
      backdrop.setAttribute("aria-hidden", "true");
    }
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    if (scanStream) {
      scanStream.getTracks().forEach((track) => track.stop());
      scanStream = null;
    }
    setScanStatus("");
  }

  async function scanLoop({ onSelect, onStatus }) {
    if (!scanActive || !scanDetector) return;
    const video = document.querySelector("#scanVideo");
    if (!video) return;
    try {
      const barcodes = await scanDetector.detect(video);
      if (barcodes?.length) {
        const rawValue = barcodes[0].rawValue || barcodes[0].rawValueText || "";
        const apparatusValue = findApparatusFromScan(rawValue);
        if (apparatusValue) {
          onSelect?.(apparatusValue);
          stopScanner();
          return;
        }
        setScanStatus(`Scanned ${rawValue}. No matching apparatus found.`);
        onStatus?.(`Scanned ${rawValue}. No matching apparatus found.`);
      }
    } catch {
      // Ignore frame errors
    }
    requestAnimationFrame(() => scanLoop({ onSelect, onStatus }));
  }

  window.DFDScanner = {
    startScanner,
    stopScanner,
  };
})();
