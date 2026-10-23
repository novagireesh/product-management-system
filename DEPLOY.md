# Putting the app online for free

**Oracle Cloud "Always Free" server + free DuckDNS web address + automatic HTTPS (Caddy).**
Cost: ₹0. Time: about 45 minutes the first time.

When you are done, the app runs at an address like `https://yourcompany.duckdns.org`, which buyers and staff can open from anywhere, and every QR code points there.

---

## Part A — Create the two free accounts (you)

### 1. Oracle Cloud
1. Go to **https://cloud.oracle.com/free** → *Start for free*.
2. Fill in your details. Oracle asks for a debit/credit card **only to verify your identity** — Always Free resources are not charged.
3. **Home region:** choose **India West (Mumbai)** or **India South (Hyderabad)**. It cannot be changed later.
4. Recommended once the account is ready: **Billing → Upgrade to Pay As You Go**. Always Free resources stay free, and Oracle no longer reclaims "idle" free servers (a quiet business app can look idle). Then create a **Budget** with an alert at ₹1 so you are told if anything ever costs money.

### 2. DuckDNS (free web address)
1. Go to **https://www.duckdns.org** and sign in (Google or GitHub).
2. Add a sub domain, e.g. `yourcompany` → your address becomes **`yourcompany.duckdns.org`**.
3. Keep the page open — you will paste the server's IP here, and you need the **token** shown at the top.

> Choose the name carefully: printed QR labels will contain this address.

---

## Part B — Create the free server (Oracle console)

1. **Menu → Compute → Instances → Create instance**.
2. **Name:** `pms`.
3. **Image:** *Canonical Ubuntu 24.04*.
4. **Shape:** *Ampere → VM.Standard.A1.Flex*, **2 OCPUs, 12 GB memory** (shown as "Always Free-eligible").
   If it says *Out of capacity*, try another *Availability domain*, try again later, or choose *AMD → VM.Standard.E2.1.Micro* (also free; the setup adds swap memory automatically).
5. **Networking:** create a new virtual cloud network with a **public subnet** and **Assign a public IPv4 address** = yes.
6. **SSH keys:** *Generate a key pair for me* → **Save private key**. Keep this file safe (e.g. `C:\Users\<you>\pms-key.key`) — it is the key to your server.
7. **Create**. When it is *Running*, copy the **Public IP address**.
8. **Open the web ports:** on the instance page click the **Subnet** → **Default Security List** → **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP protocol *TCP*, Destination port range **`80,443`** → *Add*.
9. In **DuckDNS**, paste the public IP next to your sub domain → *update ip*.

---

## Part C — Upload and install (your PC)

Open **PowerShell** in the app folder (`Barcode Generator`).

1. **Make the package** (do this right before uploading so it has your latest data):
   ```
   npm run package -- --with-data
   ```
   This creates `deploy-package\pms-<date>-with-data.tar.gz` (≈ 11 MB).

2. **Protect the key file** (Windows refuses keys that other users can read):
   ```
   icacls "C:\Users\<you>\pms-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"
   ```

3. **Upload the package** (replace the key path, file name and IP):
   ```
   scp -i "C:\Users\<you>\pms-key.key" deploy-package\pms-<date>-with-data.tar.gz ubuntu@<server-ip>:~
   ```

4. **Connect to the server:**
   ```
   ssh -i "C:\Users\<you>\pms-key.key" ubuntu@<server-ip>
   ```

5. **On the server**, unpack and run the setup (replace the address and DuckDNS token):
   ```
   mkdir -p ~/pms && tar -xzf ~/pms-*-with-data.tar.gz -C ~/pms
   sudo bash ~/pms/deploy/setup-server.sh yourcompany.duckdns.org <your-duckdns-token>
   ```
   The script installs Node.js, Caddy and PM2, opens the server firewall, starts the app, enables HTTPS,
   makes the app start after a reboot, schedules a nightly backup and sets the QR address. It ends with **Done. Open https://…**

6. Open **https://yourcompany.duckdns.org** and sign in with your existing admin account.

---

## Part D — After going live

- **Reprint QR labels.** Labels printed on your PC contain the PC's local address; new labels contain the internet address. (Barcode / QR page.)
- **Use only the online copy** from now on. Changes made in the copy on your PC are not sent to the server.
- **Create accounts** for your client's staff: *Users & Permissions* (Sales, Accounts, Production, Management).
- Optional: set a **costing PIN** in *Settings › Scanning & security*.
- **Backups:** the server saves one every night at 02:00 (last 14 kept) in `~/pms/data/backups`. Once a week, also use *Settings › Backup & system › Download backup* to keep a copy off the server.

---

## Updating the app later

On your PC (app only — **without** `--with-data`, so the server's data is not replaced). Run the tests first;
they must end with **ALL PASSED**:
```
npm test
npm run package
scp -i "C:\Users\<you>\pms-key.key" deploy-package\pms-<date>.tar.gz ubuntu@<server-ip>:~
ssh -i "C:\Users\<you>\pms-key.key" ubuntu@<server-ip>
```
On the server:
```
tar -xzf ~/pms-<date>.tar.gz -C ~/pms && bash ~/pms/deploy/update-server.sh
```
`update-server.sh` takes a backup first, installs what is needed and restarts the app.

---

## If something does not work

| Problem | Fix |
|---|---|
| `UNPROTECTED PRIVATE KEY FILE` | Run the `icacls` command in Part C step 2. |
| The address does not open | Check DuckDNS shows the server's IP; check the ingress rule for ports 80,443 (Part B step 8). On the server: `sudo systemctl status caddy` |
| Page says the app is unavailable | On the server: `pm2 status` and `pm2 logs pms` |
| Restart the app | `pm2 restart pms` |
| Restore a backup | Stop with `pm2 stop pms`, unzip the backup into `~/pms/data` (replacing `app.db` and `uploads`), then `pm2 start pms` |
