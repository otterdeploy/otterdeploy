import { describe, expect, test } from "vite-plus/test";

import {
  certCoversDomain,
  checkKeyMatchesCertificate,
  parseCertificateChain,
  splitPemCertificates,
} from "../x509";

// ─── fixtures (generated with openssl, 100-year validity so they don't rot) ──
// RSA-2048 self-signed leaf: CN=custom.example.com,
// SANs custom.example.com + www.custom.example.com.
const RSA_CERT = `-----BEGIN CERTIFICATE-----
MIIDVjCCAj6gAwIBAgIUNeGxSuNQThVGB3BwVGafS/zMqTcwDQYJKoZIhvcNAQEL
BQAwHTEbMBkGA1UEAwwSY3VzdG9tLmV4YW1wbGUuY29tMCAXDTI2MDcwOTIwMzQx
OFoYDzIxMjYwNjE1MjAzNDE4WjAdMRswGQYDVQQDDBJjdXN0b20uZXhhbXBsZS5j
b20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDFMCWCWzfkALdkqIak
P0uVHsIMgtQem63LrcFQnGjp4usXDpe2/HyUcTONRg0IbV3V4jMPVBMbj9+/pWr9
t0GgPmh2oqSDCOhHJV+uI8wNSm9/ZBWmy/Zi4RDaPZARWgbOrLLC5+5Hj1OA6p70
fK4r4+ztyT5g4hGDE58LHpngZMaTU/iFRGLTqaqSNvd1eBFdOoAAv/xDGOel2Wqz
U+kSQc8HH/5M0HaQVuT+OOUslaWYIOuw9n5SwYWPFLhoTNb9FScmHc6qVOvVt9T3
QhuMl4FDknzfEEw5JQEYowtjBUrW/IoM1kGi6+p+w5zrnWCCe9OZKDLIJFZzdONS
6wIRAgMBAAGjgYswgYgwHQYDVR0OBBYEFE+jvBpEcL2odgGxvDpnEBG0MssNMB8G
A1UdIwQYMBaAFE+jvBpEcL2odgGxvDpnEBG0MssNMA8GA1UdEwEB/wQFMAMBAf8w
NQYDVR0RBC4wLIISY3VzdG9tLmV4YW1wbGUuY29tghZ3d3cuY3VzdG9tLmV4YW1w
bGUuY29tMA0GCSqGSIb3DQEBCwUAA4IBAQCQvPD07Qw6OJb39APiui1ZLLid1/ML
RUaMcuGaTUHbUywFAuqmem4jE7HW6oFNsHcL57DdMbI0t0npTvfllj2VXlKiAALQ
CDOO0kdjHh+1yn2qLTvduw+ftTEWd0aNVy0/oZ83MjlAFV6GIy7OXuN5ZYfbkNWU
pf7TVov0j3hvx+UjXeydHx2uf38HCPhUIQLa+HxDQMBiQfaWIExOLKnoK/mNUWil
WPeGS/jYBGC+hrxv0sScDRrptp70lMR400sX5D+FY/DH3zKQQtp6uMRcvNCf8rZ3
Wcbsz+aJm4VrnGaGWc3kJjMz9RmSXXq9e3rpop9ZxdsWqjM5wTuRdmZD
-----END CERTIFICATE-----`;

const RSA_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDFMCWCWzfkALdk
qIakP0uVHsIMgtQem63LrcFQnGjp4usXDpe2/HyUcTONRg0IbV3V4jMPVBMbj9+/
pWr9t0GgPmh2oqSDCOhHJV+uI8wNSm9/ZBWmy/Zi4RDaPZARWgbOrLLC5+5Hj1OA
6p70fK4r4+ztyT5g4hGDE58LHpngZMaTU/iFRGLTqaqSNvd1eBFdOoAAv/xDGOel
2WqzU+kSQc8HH/5M0HaQVuT+OOUslaWYIOuw9n5SwYWPFLhoTNb9FScmHc6qVOvV
t9T3QhuMl4FDknzfEEw5JQEYowtjBUrW/IoM1kGi6+p+w5zrnWCCe9OZKDLIJFZz
dONS6wIRAgMBAAECggEAA18Ea1Sh26SEIQwruDRGi+lmrwbBS/GqXkdpH+sGdPeN
41DdwY0Mo+zFnOwsvIxOS/8N/DDxhvUgNhVnphyPAySTFqyvwI6+/sVMMFnmANT8
BGoxMTTNVk2nPUOROPMVgB5eIwPE7/JNpI1VlTnHR4PzhTd3uRDlF4W/pizzDRxc
OWW6YjzW53+LCh3jy1ka6Q1xhyO8EL99+iiFMYJKy5csyYRqzKDSAz8QtCch6RGK
xBwXqLR0yKYrx73uUMOUFC1IKl9rSZP1ojbXPSNAN/Y0S0/6F5AppzJYTuiBH/xA
8ql2GVakL2lS478I+Mq6fkMtFv+v7eDw/kLDCP6s3QKBgQD6t/N0v+yJGvNv3J44
c7I6DbDjJCd2KC5V3mUMyJYAdX0DrLmdfUN2DIt//ueq7ARf8ChrEkpr0cfQu2EO
ZvTDbYkkKLY5Ajgk5b6sgrpfw9EGROnPCJ/1ATq6xfcpE8gFrL5Tn2DrhcGjFeX4
vUUW8DHrOkacTZLood267+QpDQKBgQDJV4WZjVhLuEmjoozOsnh0uxkrkSGRJ3mU
aJ51D07Ch3mC1VBIfNf4L5dKfCdCq6oQYTBUxsvtcdadLEDP549fx4v5mNuaGjbu
f34cFe4Z1vV6qe75n2YzoL91e7YfMToI5AFQaU++1ziiwXzgI+yDW+maxV2JI5Tz
+FqEHxE0FQKBgAmvubQ1Bgp2BBm6SFKeBbDAfqkH6I5kFwYyRW0tAr6Zy26s6a7v
+/8/lNQpIQI1hCXAvY8FceKghDvIQYOw7pvuS3IeMIwbTdf/GFLJ6jFw+05mszHQ
f32TwpUcuOPZY8z0U5YffjsbO9P1MKFfjp/IP+V6pue7B4X9Wvex9PqxAoGAJyCb
Ffwh7JUjumkcdA662fSCL7VEkLDbL7wlDxqqc6NgOcy6jVu1nMWi4Ra/inVR110L
x23as4or6t9uuPiHJFXjHd5WztvJUQ/1sf+RBfSAQBZGGryfX+kdS/d+rREj9hZZ
KwdMOAobN4Xifqx8igqSm0E/rCb+C2t4K7Td4wECgYBD9/A1A9bdmSXbDyxldJlY
fthXxbV7U/QL1Y0VyCGQPxi82bhMyL6Y5LORbqN5RFbn1iMeiRMBQocs9OwyNMeF
VtGjRloYBphnxNDDZgxsvA5yS99kMuC4w7ZOcLEkmO/LjBmtHNB3jafCldnz4IkU
0p7AGBeos8dfBFVV/k651A==
-----END PRIVATE KEY-----`;

// EC P-256 self-signed wildcard leaf: CN=*.wild.example.com, SAN *.wild.example.com.
const EC_CERT = `-----BEGIN CERTIFICATE-----
MIIBsDCCAVagAwIBAgIUBtXlTrSImE3GrrstDyqvJrXwdSwwCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwSKi53aWxkLmV4YW1wbGUuY29tMCAXDTI2MDcwOTIwMzQxOFoY
DzIxMjYwNjE1MjAzNDE4WjAdMRswGQYDVQQDDBIqLndpbGQuZXhhbXBsZS5jb20w
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATia5DeWzqaByYX3yuwdQAc/AMyEVc0
TM+mf03IPpI8awi542epIQllZmLCmqexD9k6UIp3Rs5LuAO1dRBEHUgOo3IwcDAd
BgNVHQ4EFgQUb0KyTQAT1Hwd8c2+0q9Y1hUkCRcwHwYDVR0jBBgwFoAUb0KyTQAT
1Hwd8c2+0q9Y1hUkCRcwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHREEFjAUghIqLndp
bGQuZXhhbXBsZS5jb20wCgYIKoZIzj0EAwIDSAAwRQIgU5zG78sta2kkhhzmu92w
bktNMvqOoU8AcVthLejdpKkCIQDEG5VnKmxBtW2d68bHPeRNlxPM5I4EwJBTioNL
H7h3QA==
-----END CERTIFICATE-----`;

const EC_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg69p0beiZy73E0FgW
ytz3Mgxr5ZfNyWsxInPlHl6YbEOhRANCAATia5DeWzqaByYX3yuwdQAc/AMyEVc0
TM+mf03IPpI8awi542epIQllZmLCmqexD9k6UIp3Rs5LuAO1dRBEHUgO
-----END PRIVATE KEY-----`;

// A DIFFERENT RSA key (pairs with no fixture cert) — for mismatch tests.
const OTHER_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC2jaryS5lMjnCM
p4N6DV8ykUy1CYwXzshHg7KJNUpG44MGOJxCsNbjYhLVFW1hnw9Dipb77DagDS7l
VIr+mnrASxO3dLEhL1SHeBbeRMJJo00B3NtkVvfeRmc/US03dC50hzmElg8p8lR+
pXaUH+5J462CDtx4Jl9oIE4ENBpkh/MV9xDvolOP1Z9jEh8qb6kOghixBNe5vGAz
kKugkOFK4Hxl1GhM1FC413f0Na+n0GG0FidDjEZjRI/xmPX2OzdD3isanyVbSE0E
z09rt6VlYGJHmiEgfFJ2+mvFIDCQI4tkCMvrJXFqU7bx2h1xqyzSTncvAKMLNPHc
XSe1jLfPAgMBAAECggEAFNAyHU3hPIlA68hthQzhPbKzPDDKeCxrSTwKrvoUbeCi
n6L0reXbmjEkVIcM4YRxCRJUBIT59WWLYzowXrbeJ+5nYRM83ru2t3tJoC3WuO6V
aRD1Mot31y/Ptbhbn2bvpPmF5Uf2kqG+YHIdAuZhFKuQrLNlD43Qct68Bl6qY6uq
avlX0y7/BI0+AR3nON9xhVWaADkVCRxQRW3GgsRMAGFHIPWaogI7vE3YvvSLQmDR
DB9iE0vpjlR/cnW161ACYQ1LnXbjXpYBgboludfsE5sBBQafy7y11fbl5Cdglvuv
fYrM+UhjJrzT4vSAUbUtTkgC6izqoB1jpmI5iRLEgQKBgQD+EiEUbAU/1YcrdeL0
uW+jN5Kl7ZY5f785ngU4Sr0cFVivHVoMRrhs72M2yGEniN5JK1qjRkxv/+1q9u7l
xKofVfBlD23DCRqVQjsa8r9vFJZ8vafS66UvBf68w9lrxXnL+VTpwStzp5RBZ/wa
svoZ/ml+1iNIyBeVVRGFwHRsvQKBgQC38IVO3C9dnEjiKrh5JavLkZ7jfSjRrigi
r+yeEyCOx3CFZRhi465UwxiJF6PxIl6EoWLFrdUM2ukJVO/xdeLZ8t+il3Dxwa+i
HbnGJtK7rTA/cHflbFOFeVFXdzqL1k1uhKmn6sCN9kcLMvepuh4x9JpgbScxQBll
K4xSFZBtewKBgFXksyJAUpX+DjB3Lj8l4cQAKafG5p6RvYgxD/qz6bLw1IZ/Gc5E
qlzJoXUH0TCYaO27pmzEe1rx3sXmrWUoU4s8doTz7ludXEtRlMHLh0R6ZVXOmEoK
OFHpaPFQFNUGceKvbDGKiLIU2V4zVVuBXmQjSm8C3fLhEnf9xmq9YZ7RAoGAOpx+
rgFFaovJQaAhRiE129kcCxsvrZjUGzF5sWkg3743YZo0Khaoz0OXht+sksLD4XlX
cuwQTldXGG0jRAqvbYmRr0qYZ8CzCXJ1ZumqDrmB/UUGP2nEN2zP+ZH5auOvqr7F
HMeV8eZ+/tePyVqQEpUBuCYv7eah8PXucZ2Ddw8CgYEAgOVuJvXJ4rpOCHNLJ1LA
CvuiWFCMa2IYcfVHMYQ46zcaHP4xmNW1f3Zm6vqb6sJzva+rPX4+YulbLFqUH8DT
LIPBP3Tmc86Wh7cSYhFByhC1GlJVUD202dUNco1OHkq2LHnMgbLykiZwTIsvKmo6
83XdJbZSgDmUWFvBSQyz0qQ=
-----END PRIVATE KEY-----`;

// Root CA (CA:TRUE, no SANs): CN=Test Root CA, O=otterdeploy-tests.
const CA_CERT = `-----BEGIN CERTIFICATE-----
MIIDSTCCAjGgAwIBAgIUPKU4RvtfOiCbHBCtTAKMAez5AZcwDQYJKoZIhvcNAQEL
BQAwMzEVMBMGA1UEAwwMVGVzdCBSb290IENBMRowGAYDVQQKDBFvdHRlcmRlcGxv
eS10ZXN0czAgFw0yNjA3MDkyMDM0MTlaGA8yMTI2MDYxNTIwMzQxOVowMzEVMBMG
A1UEAwwMVGVzdCBSb290IENBMRowGAYDVQQKDBFvdHRlcmRlcGxveS10ZXN0czCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALDx03bB5BHMQ/u26YN0q9fQ
neWSMfbe1MMebszu3PmtYXEgT+ziNxp7MGPfQ2eHUi/OsB5z+eEs+vXH9Q9C7KOD
UnV0yieXvEsk9/I9HG5SSR6sHRb5UVs83HS4p9qDD2k74N+3VnU/Kx33/iFvI7PX
gAzFwvu+zRz8B3RQtauXagx7OLjW7LPWLR1+ErxGnhlsltcXXfrv3uhIdHJwtJ6x
KF2bwfPRuj6Y/nlaY+Vp7Q+bcYHPPxqn3tmf2K1nUVbW0pxov8zhmeCwvxwE0pbC
z6BIPpQ+w3uOJ+MS/NhtZl42/t2c1XEXEPWrZeDvIS6B7F4KuIjV274aGDtODIcC
AwEAAaNTMFEwHQYDVR0OBBYEFLJNLUeagAYpqbwpa6cWnFY3QkGHMB8GA1UdIwQY
MBaAFLJNLUeagAYpqbwpa6cWnFY3QkGHMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAJbo5DAtFN54bZs17HJGINWTzTfVejpIxHZfzFHsdnTk278H
01l7QbB2tg0v9WkLOzVfEShZA1XhuU5y9txn/uAsD7l2NeBDu8oGKEJQMWsEDXf9
qOzQnJ3rudcWNT+TbpIkoNoPlqrPzf/FG/2vUQsKILsAWUDLtQjjFIHTx59MX2L7
yfjgW6Cb6BeKZXQI0IqYmsYzfW/zD9Xq4HSpEe26lE/Nh3zf+ufsp115sF2LLAgh
Q1qKL043CAyKk1wkdgzgucuhRMU0tZIu/EqOMNdzWnveDtHgVBBIb/pQCOO7NJcQ
JRGBuEXZ92gNPIGweQrMH07iaAy8YlmV/vF2wPs=
-----END CERTIFICATE-----`;

describe("splitPemCertificates", () => {
  test("splits a chain into individual blocks", () => {
    const chain = `${RSA_CERT}\n${CA_CERT}\n`;
    const blocks = splitPemCertificates(chain);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("BEGIN CERTIFICATE");
  });

  test("ignores surrounding noise and returns [] when no block exists", () => {
    expect(splitPemCertificates("not a pem")).toEqual([]);
    expect(splitPemCertificates(RSA_KEY)).toEqual([]);
  });
});

describe("parseCertificateChain", () => {
  test("extracts leaf metadata from an RSA cert", () => {
    const result = parseCertificateChain(RSA_CERT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaf.subjectCN).toBe("custom.example.com");
    expect(result.leaf.sans).toEqual(["custom.example.com", "www.custom.example.com"]);
    expect(result.leaf.keyAlg).toBe("RSA 2048");
    expect(result.leaf.selfSigned).toBe(true);
    expect(result.leaf.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(Date.parse(result.leaf.notAfter)).toBeGreaterThan(Date.now());
    expect(result.certCount).toBe(1);
  });

  test("extracts EC key algorithm and wildcard SAN", () => {
    const result = parseCertificateChain(EC_CERT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaf.keyAlg).toBe("ECDSA P-256");
    expect(result.leaf.sans).toEqual(["*.wild.example.com"]);
  });

  test("takes the FIRST cert as the leaf in a multi-cert chain", () => {
    const result = parseCertificateChain(`${RSA_CERT}\n${CA_CERT}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaf.subjectCN).toBe("custom.example.com");
    expect(result.certCount).toBe(2);
  });

  test("flags a CA certificate (basicConstraints CA:TRUE, no SANs)", () => {
    const result = parseCertificateChain(CA_CERT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaf.isCa).toBe(true);
    expect(result.leaf.sans).toEqual([]);
    expect(result.leaf.subject).toContain("O=otterdeploy-tests");
  });

  test("rejects input with no certificate block", () => {
    const result = parseCertificateChain("garbage");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no CERTIFICATE block");
  });

  test("rejects a corrupted certificate body", () => {
    const corrupted = RSA_CERT.replace(/MIIDVjCC/g, "AAAAAAAA");
    const result = parseCertificateChain(corrupted);
    expect(result.ok).toBe(false);
  });
});

describe("checkKeyMatchesCertificate", () => {
  test("accepts the matching RSA pair", () => {
    expect(checkKeyMatchesCertificate(RSA_CERT, RSA_KEY)).toEqual({ ok: true });
  });

  test("accepts the matching EC pair", () => {
    expect(checkKeyMatchesCertificate(EC_CERT, EC_KEY)).toEqual({ ok: true });
  });

  test("rejects a key that pairs with a different cert", () => {
    const result = checkKeyMatchesCertificate(RSA_CERT, OTHER_KEY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("does not match");
  });

  test("rejects a non-key blob with a parse error", () => {
    const result = checkKeyMatchesCertificate(
      RSA_CERT,
      "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("private key did not parse");
  });

  test("rejects passphrase-protected keys with an actionable message", () => {
    const result = checkKeyMatchesCertificate(
      RSA_CERT,
      "-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("passphrase");
  });
});

describe("certCoversDomain", () => {
  const names = { subjectCN: "custom.example.com", sans: ["www.custom.example.com"] };

  test("matches CN and SANs exactly (case-insensitive)", () => {
    expect(certCoversDomain(names, "custom.example.com")).toBe(true);
    expect(certCoversDomain(names, "WWW.Custom.Example.Com")).toBe(true);
    expect(certCoversDomain(names, "other.example.com")).toBe(false);
  });

  test("wildcard covers exactly one extra label", () => {
    const wild = { subjectCN: null, sans: ["*.wild.example.com"] };
    expect(certCoversDomain(wild, "a.wild.example.com")).toBe(true);
    expect(certCoversDomain(wild, "a.b.wild.example.com")).toBe(false);
    expect(certCoversDomain(wild, "wild.example.com")).toBe(false);
  });

  test("empty / no names never match", () => {
    expect(certCoversDomain({ subjectCN: null, sans: [] }, "x.example.com")).toBe(false);
    expect(certCoversDomain(names, "")).toBe(false);
  });
});
