/**
 * Deliberately legacy HTML (blueprint §4 D6, D3): frameset shell, table layout, <font> tags, no ids,
 * no ARIA, no test IDs. The only reliable way to target anything is a human-visible label/row anchor
 * or an accessibility role+name — which is exactly the robustness story we want to exercise.
 */
import type { Member, TenantBrand } from "./data.js";

const doc = (title: string, brand: TenantBrand, body: string): string =>
  `<!doctype html><html><head><title>${title}</title></head>` +
  `<body bgcolor="${brand.bg}" style="font-family:Verdana,Geneva,sans-serif;font-size:12px;margin:0">` +
  `<table width="100%" bgcolor="#1b3a6b" cellpadding="8"><tr><td>` +
  `<font color="#ffffff" size="4"><b>${brand.brandName}</b></font></td></tr></table>` +
  `<div style="padding:14px">${body}</div></body></html>`;

export const loginPage = (t: string, brand: TenantBrand): string =>
  doc("Sign On", brand, `
    <font size="3"><b>Operator Sign On</b></font>
    <form method="post" action="signon">
      <table cellpadding="4" border="0">
        <tr><td>User ID</td><td><input type="text" name="userId" value="teller01"></td></tr>
        <tr><td>Password</td><td><input type="password" name="password"></td></tr>
        <tr><td></td><td><input type="submit" value="Sign On"></td></tr>
      </table>
    </form>`);

export const desktopFrameset = (t: string): string =>
  `<!doctype html><html><head><title>Desktop</title></head>` +
  `<frameset cols="180,*" border="1">` +
  `<frame name="menu" src="menu">` +
  `<frame name="content" src="content">` +
  `</frameset></html>`;

export const menuFrame = (t: string, brand: TenantBrand): string =>
  doc("Menu", brand, `
    <font size="2"><b>Servicing</b></font>
    <table cellpadding="3"><tr><td><a href="content" target="content">Member Search</a></td></tr>
    <tr><td><a href="content" target="content">Accounts</a></td></tr></table>`);

export const searchScreen = (t: string, brand: TenantBrand): string =>
  doc("Member Search", brand, `
    <font size="3"><b>Member Search</b></font>
    <form method="post" action="find">
      <table cellpadding="4" border="0">
        <tr><td>Member #</td><td><input type="text" name="memberNo"></td></tr>
        <tr><td></td><td><input type="submit" value="Find"></td></tr>
      </table>
    </form>`);

export const interstitialScreen = (t: string, brand: TenantBrand, id: string): string =>
  doc("System Notice", brand, `
    <table bgcolor="#fff6d6" cellpadding="10" border="1"><tr><td>
      <font size="3"><b>System Notice</b></font><br>
      A scheduled maintenance banner is displayed. Acknowledge to continue.<br><br>
      <a href="detail?id=${id}">Continue</a>
    </td></tr></table>`);

export const detailScreen = (t: string, brand: TenantBrand, m: Member): string =>
  doc("Member Detail", brand, `
    <font size="3"><b>Member Detail</b></font>
    <table cellpadding="5" border="1" bgcolor="#ffffff">
      <tr><td>Member Name</td><td>${m.name}</td></tr>
      <tr><td>Member #</td><td>${m.id}</td></tr>
      <tr><td>Checking Balance</td><td>${m.checking}</td></tr>
      <tr><td>${brand.savingsLabel}</td><td>${m.savings}</td></tr>
    </table>
    <br><a href="subaccount?id=${m.id}">Open New Sub-Account</a>`);

export const notFoundScreen = (t: string, brand: TenantBrand): string =>
  doc("Not Found", brand, `<font size="3" color="#8a1f1f"><b>No such member</b></font>
    <p>The member number was not found. Verify and try again.</p>`);

export const permissionScreen = (t: string, brand: TenantBrand): string =>
  doc("Denied", brand, `<font size="3" color="#8a1f1f"><b>Not authorized</b></font>
    <p>You are not authorized to view this account.</p>`);

export const expiredScreen = (t: string, brand: TenantBrand): string =>
  doc("Session Expired", brand, `<font size="3" color="#8a1f1f"><b>Session expired</b></font>
    <p>Your session has expired. Please sign on again.</p>`);

export const subAccountForm = (t: string, brand: TenantBrand, m: Member): string =>
  doc("New Sub-Account", brand, `
    <font size="3"><b>Open New Sub-Account</b></font>
    <form method="post" action="subaccount-create">
      <input type="hidden" name="id" value="${m.id}">
      <table cellpadding="4" border="0">
        <tr><td>Account Type</td><td><select name="acctType"><option>Savings</option><option>Checking</option><option>Money Market</option></select></td></tr>
        <tr><td>Initial Deposit</td><td><input type="text" name="deposit" value="0.00"></td></tr>
        <tr><td></td><td><input type="submit" value="Create Sub-Account"></td></tr>
      </table>
    </form>`);

export const confirmationScreen = (t: string, brand: TenantBrand, m: Member, ref: string): string =>
  doc("Confirmation", brand, `
    <font size="3" color="#1f6b2a"><b>Confirmation</b></font>
    <table cellpadding="5" border="1" bgcolor="#ffffff">
      <tr><td>Status</td><td>Sub-account created</td></tr>
      <tr><td>Member #</td><td>${m.id}</td></tr>
      <tr><td>Reference</td><td>${ref}</td></tr>
    </table>`);

export const transientBody = (brand: TenantBrand): string =>
  doc("Unavailable", brand, `<font size="3" color="#8a1f1f"><b>Service temporarily unavailable</b></font>
    <p>Please retry your request.</p>`);
