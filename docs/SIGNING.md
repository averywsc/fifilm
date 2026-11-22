# Windows Code Signing for Fifilm

## Why Windows SmartScreen blocks unsigned `.exe` files
Windows Defender SmartScreen shows **"Windows protected your PC"** whenever an `.exe` is not signed by a publicly trusted Certificate Authority (CA).

- A **self-signed certificate** can only stop warnings on *your own machine* if you manually install it into your PC's Trusted Root store. It will **still trigger SmartScreen on other people's Windows PCs**.
- To remove the warning for **everyone** downloading Fifilm, sign the release `.exe` files with a publicly trusted Code Signing Certificate.

---

## Best Ways to Get a Trusted Windows Certificate

### Option 1 — SignPath Foundation (FREE for Open Source)
[SignPath Foundation](https://signpath.org/) provides free, publicly trusted DigiCert-backed Windows code signing for open-source GitHub repositories via GitHub Actions.
1. Ensure your GitHub repo (`averywsc/fifilm`) has a public open-source license (`MIT`).
2. Apply at `https://signpath.org/projects/submit/` and link `averywsc/fifilm`.
3. Once approved, add the SignPath GitHub Action step or signing token to `.github/workflows/release.yml`.

### Option 2 — Microsoft Azure Trusted Signing (Instant SmartScreen Clearance, ~$9.99/mo)
Microsoft's **Trusted Signing** service signs executables in GitHub Actions and gives immediate SmartScreen trust without waiting to build download reputation.
1. Create a **Trusted Signing Account** and **Certificate Profile** in the Azure Portal.
2. Add these 6 Repository Secrets in GitHub (`Settings -> Secrets and variables -> Actions`):
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID`
   - `AZURE_CLIENT_SECRET`
   - `AZURE_SIGNING_ENDPOINT` (e.g. `https://eus.codesigning.azure.net`)
   - `AZURE_SIGNING_ACCOUNT`
   - `AZURE_SIGNING_PROFILE`
3. Re-run **Build & Release Windows .exe** in GitHub Actions. `.github/workflows/release.yml` is already wired to automatically sign both `.exe` files with `azure/trusted-signing-action`.

### Option 3 — Standard `.pfx` Certificate (Certum / SSL.com / Sectigo / DigiCert)
If you buy a `.pfx` Code Signing Certificate:
1. Base64-encode your `.pfx` file and add these 2 GitHub Repository Secrets:
   - `WIN_CSC_LINK` (base64 `.pfx` string)
   - `WIN_CSC_KEY_PASSWORD` (certificate password)
2. Re-run **Build & Release Windows .exe** in GitHub Actions (already wired in `.github/workflows/release.yml`).
3. Or sign locally using:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/sign_exe.ps1 -PfxPath C:\path\to\cert.pfx
   ```

---

## Opening an Unsigned Build Right Now
While waiting for a public certificate:
- On the blue Windows SmartScreen popup, click **More info** -> **Run anyway**.
- Or right-click `Fifilm-Setup-0.1.0.exe` -> **Properties** -> check **Unblock** at the bottom -> **OK**.
