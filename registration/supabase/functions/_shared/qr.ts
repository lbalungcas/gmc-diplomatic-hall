import QRCode from 'npm:qrcode@1.5.4';

/** PNG of the ticket URL, base64-encoded for an inline (CID) email attachment. */
export async function qrPngBase64(text: string): Promise<string> {
  const dataUrl: string = await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 480,
    color: { dark: '#0f2240', light: '#ffffff' },
  });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
