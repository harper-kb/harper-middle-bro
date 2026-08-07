# ACORD Forms & Carrier NAIC Research

Research document for the underwriter-desk certificate stack. Covers: (1) ACORD 30
(the "garage liability" certificate), (2) ACORD 28 (Evidence of Commercial Property
Insurance), (3) verified NAIC company codes for the desk's carriers, and (4) a brief
future-direction note on aviation certificate forms.

**Accuracy notes, read first:**

- ACORD forms are copyrighted. The specs below are structural descriptions compiled
  from the official ACORD Forms Index, a state-DOI-hosted official copy (ACORD 28),
  and publicly posted specimen/filled copies (ACORD 30). Before building renderers,
  the exact box geometry should be confirmed against a licensed blank of each form
  (via the agency's forms provider or acord.org).
- Anything that could not be confirmed from a source is explicitly marked
  **UNVERIFIED** below. Nothing in this document is guessed.
- **Edition alert for the existing ACORD 25 implementation:** the official ACORD
  Forms Index (retrieved Aug 2026) lists ACORD 25's current edition as **2025/12**,
  not 2016/03. The December 2025 ACORD Forms Notification bulletin describes the
  changes: updated logo/copyright, an asterisked "LIMITS SHOWN MAY HAVE BEEN
  REDUCED BY PAID CLAIMS" (with "*Not Applicable in WY" footnote), a new sentence
  "LIMITS SHOWN ARE INCLUSIVE OF AMOUNTS REQUESTED BY THE CERTIFICATE HOLDER AND
  MAY NOT REFLECT POLICY LIMIT AMOUNTS IN EXCESS OF THOSE REQUESTED.", and a
  reformatted coverages grid **with the same data fields**. `src/lib/acord25.ts`
  documents itself as ACORD 25 (2016/03); the section/field model appears
  unchanged, but the certification wording and edition footer are not current.
  **Section 5 below carries the full verbatim 2016/03 → 2025/12 diff.**
  Sources: [ACORD Forms Index](https://www.acord.org/docs/default-source/forms/forms_index.pdf),
  [ACORD Forms Notification, December 2025](https://www.acord.org/docs/default-source/forms/forms-notifications/acord-forms-notification-december-2025.pdf).

---

## 1. ACORD 30 — Certificate of Garage Insurance

### What it actually is

ACORD 30 is the **Certificate of Garage Insurance** — the user's "garage liability
form" is this certificate. It is a live, current form (not withdrawn): the official
ACORD Forms Index lists **ACORD 30, current edition 2016/03, "Certificate of Garage
Insurance"**, and ACORD's Certificates FAQ names it among the active certificate
forms. It is the purpose-built certificate for garage risks (used-car dealers,
repair shops, service stations, tow operators) and is the correct vehicle for
garage liability certificates — **not** ACORD 25, which has no garage liability or
garagekeepers blocks. (ACORD 128 "Garage and Dealers Section" also exists, but that
is an *application* section, not a certificate.)

The form is a single page and is structurally a sibling of ACORD 25: same header
(producer / insured / insurers A–F with NAIC #), same ADDL INSD / SUBR WVD columns,
same remarks-and-footer plumbing — but the coverage grid leads with two
garage-specific sections (Garage Liability and Garage Keepers Liability) followed
by CGL, Umbrella/Excess, and WC/EL rows. A single ACORD 30 can therefore evidence a
dealer's full stack.

Layout evidence: the 2010/12 blank form (full text retrieved), a filled ACORD 30
(2016/03) specimen posted by the State of Colorado procurement portal, and a second
filled 2016/03 specimen (Scribd-hosted acroform). The 2016/03 edition's visible
changes vs 2010/12: garage liability auto checkboxes read "OWNED AUTOS ONLY" (was
"ALL OWNED AUTOS"), the GL section gained the "OTHER:" aggregate write-in row
(matching ACORD 25 2016/03), and the copyright line reads
"© 2010-2015 ACORD CORPORATION … ACORD 30 (2016/03)".

### Header / identity boxes (top of form)

| Box | Content |
| --- | --- |
| DATE (MM/DD/YYYY) | Issue date, top right |
| Title + disclaimer | "CERTIFICATE OF GARAGE INSURANCE" + information-only disclaimer (identical structure to ACORD 25: confers no rights, does not amend/extend/alter coverage, not a contract) |
| IMPORTANT paragraph | Additional-insured / waiver-of-subrogation endorsement reminder (same wording pattern as ACORD 25) |
| PRODUCER | Name/address + CONTACT NAME, PHONE (A/C, No, Ext), FAX (A/C, No), E-MAIL ADDRESS |
| INSURED | Named insured and address |
| INSURER(S) AFFORDING COVERAGE | INSURER A–F rows, each with NAIC # column |
| COVERAGES strip | PROD / CUSTOMER ID, CERTIFICATE #, REVISION # |
| Certification paragraph | "THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW … LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS." |

Coverage grid columns (every section row): INSR LTR · TYPE OF INSURANCE ·
ADDL INSD · SUBR WVD · POLICY NUMBER · POLICY EFF (MM/DD/YYYY) ·
POLICY EXP (MM/DD/YYYY) · LIMITS.

### Coverage sections — structured spec (SECTION_DEFS shape)

Written in the shape of `SectionDef` in `src/lib/acord25.ts`: a `typeCell` (title,
checkbox rows, text lines in print order) and `limitBoxes` (label + backing slot;
`slot: null` = prints blank unless backed).

#### Section 1: `garageLiability` — "Garage Liability"

```
typeCell:
  title:  "GARAGE LIABILITY"
  checks: [ anyAuto        "ANY AUTO" ]
  checks: [ ownedOnly      "OWNED AUTOS ONLY" ]            // 2010/12: "ALL OWNED AUTOS"
  checks: [ hiredOnly      "HIRED AUTOS ONLY" ]
  checks: [ nonOwnedGarage "NON-OWNED AUTOS USED IN GARAGE BUSINESS" ]

limitBoxes:
  autoOnlyEaAccident   "AUTO ONLY (Ea accident)"              // $
  otherThanEaAccident  "OTHER THAN AUTO ONLY – EA ACCIDENT"   // $
  otherThanAggregate   "OTHER THAN AUTO ONLY – AGGREGATE"     // $
```

Semantics: garage liability merges the GL and auto-liability exposures of a garage
operation; the limits split into an auto-only per-accident limit and an
other-than-auto pair (each accident / aggregate). On the printed form the
"OTHER THAN AUTO ONLY" caption spans the two lower limit rows.

#### Section 2: `garageKeepers` — "Garage Keepers Liability"

```
typeCell:
  title:  "GARAGE KEEPERS LIABILITY"
  checks: [ legalLiability "LEGAL LIABILITY" ]
  checks: [ directBasis    "DIRECT BASIS" ]
  checks: [ primary "PRIMARY",  excess "EXCESS" ]   // qualify DIRECT BASIS

limitBoxes (each row pairs a perils checkbox with a LOC write-in and a $ box):
  compOtc         "COMP / OTC"        + LOC + $
  specifiedPerils "SPECIFIED PERILS"  + LOC + $
  collision       "COLLISION"         + LOC + $
  spare           (unlabeled)         + LOC + $     // blank spare row
```

Semantics (for resolver design, per IRMI definitions cited by the Ellie guide):
garagekeepers covers physical damage to customers' vehicles in the insured's care,
custody, and control. The basis checkboxes are mutually meaningful — **Legal
Liability** pays only when the insured is negligent; **Direct Basis** pays
regardless of fault, qualified as **Excess** (over the vehicle owner's own
coverage) or **Primary** (first line). The perils checkboxes (Comp/OTC, Specified
Perils, Collision) select which physical-damage perils apply, with per-location
(LOC) limits. A multi-location risk overflows to ACORD 101 (the Colorado specimen
does exactly this, tabulating per-location basis/limits on an attached ACORD 101).

#### Section 3: `gl` — "General Liability" (same model as ACORD 25 GL)

```
typeCell:
  title:  "COMMERCIAL GENERAL LIABILITY"        // under a "GENERAL LIABILITY" section head
  checks: [ claimsMade "CLAIMS-MADE",  occur "OCCUR" ]
  text:   "GEN'L AGGREGATE LIMIT APPLIES PER:"
  checks: [ aggPolicy "POLICY", aggProject "PRO-JECT", aggLoc "LOC" ]
  checks: [ aggOther  "OTHER:" + write-in ]      // present on 2016/03 specimens

limitBoxes:
  eachOccurrence   "EACH OCCURRENCE"
  damagePremises   "DAMAGE TO RENTED PREMISES (Ea occurrence)"
  medExp           "MED EXP (Any one person)"
  personalAdv      "PERSONAL & ADV INJURY"
  generalAggregate "GENERAL AGGREGATE"
  productsCompOp   "PRODUCTS - COMP/OP AGG"
  blank            ""                            // spare $ row
```

Note: unlike ACORD 25, the ACORD 30 GL type cell has **no** two unlabeled write-in
checkbox rows between OCCUR and the aggregate-applies-per block on the 2010/12
blank; the 2016/03 specimens are consistent with that. Verify against a licensed
2016/03 blank before hard-coding.

#### Section 4: `umbrella` — "Umbrella / Excess Liability" (same model as ACORD 25)

```
typeCell:
  checks: [ umbrella "UMBRELLA LIAB" (bold),  occur "OCCUR" ]
  checks: [ excess   "EXCESS LIAB"   (bold),  claimsMade "CLAIMS-MADE" ]
  checks: [ ded "DED",  retention "RETENTION $" + write-in ]

limitBoxes:
  eachOccurrence "EACH OCCURRENCE"
  aggregate      "AGGREGATE"
  blank          ""
```

#### Section 5: `wc` — "Workers Compensation and Employers' Liability" (same model as ACORD 25)

```
typeCell:
  title: "WORKERS COMPENSATION AND EMPLOYERS' LIABILITY"
  checks: pre "ANY PROPRIETOR/PARTNER/EXECUTIVE OFFICER/MEMBER EXCLUDED?"
          [ excludedNA "N / A" ]  post "Y / N (Mandatory in NH)"
  text:  "If yes, describe under REMARKS below"    // ACORD 25 says "…Description of Operations below"

limitsHead (2010/12 blank): [ "WC STATU-TORY LIMITS", "OTH-ER" ]
limitsHead (2016/03):       UNVERIFIED — ACORD 25 (2016/03) prints "PER STATUTE / OTH-ER";
                            ACORD 30 (2016/03) likely matches, but no specimen I retrieved
                            shows this cell legibly. Confirm on a licensed blank.

limitBoxes:
  elEachAccident   "E.L. EACH ACCIDENT"
  elDiseaseEmployee "E.L. DISEASE - EA EMPLOYEE"
  elDiseasePolicy  "E.L. DISEASE - POLICY LIMIT"
```

### Footer

| Box | Content |
| --- | --- |
| REMARKS | "REMARKS (Attach ACORD 101, Additional Remarks Schedule, if more space is required)" — note ACORD 30 calls this REMARKS, not "DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES" as on ACORD 25 |
| CERTIFICATE HOLDER | Name/address box, bottom left |
| CANCELLATION | "SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE EXPIRATION DATE THEREOF, NOTICE WILL BE DELIVERED IN ACCORDANCE WITH THE POLICY PROVISIONS." |
| AUTHORIZED REPRESENTATIVE | Signature line |
| Edition/copyright | "ACORD 30 (2016/03)" · "© 2010-2015 ACORD CORPORATION. All rights reserved." |

### Fit with the existing code

`SECTION_DEFS`'s `auto` section already matches `/garage liability/i` and would
claim a garage policy onto the ACORD 25 Automobile row today — which is exactly the
failure mode the Ellie guide warns about (a plain ACORD 25 cannot evidence
garagekeepers). An ACORD 30 sheet would reuse the `gl`, `umbrella`, and `wc`
descriptors nearly verbatim and add the two garage descriptors above; the
garagekeepers section needs one new concept the current `LimitBoxDef` lacks — a
per-row LOC write-in alongside the `$` box.

---

## 2. ACORD 28 — Evidence of Commercial Property Insurance

### Identity

**ACORD 28, "Evidence of Commercial Property Insurance", current edition 2016/03**
(official ACORD Forms Index, retrieved Aug 2026). One page; a filled-field census
by Instafill counts 159 fillable fields. Unlike the certificate forms it is
addressed to an **Additional Interest** (mortgagee/lender/loss payee), not a
"certificate holder", and one form covers **one company/policy** — multiple
companies require separate forms. The full text below was taken from the official
copy hosted by the New York DFS (approved-forms library).

Distinctions worth encoding: ACORD 27 is the *personal/small residential* evidence
form; ACORD 24 is the certificate (not evidence) of property insurance. Lenders
with an insurable interest ask for 27/28 because evidence forms carry
mortgagee-facing content the certificates don't.

### Header / disclaimer

Title "EVIDENCE OF COMMERCIAL PROPERTY INSURANCE" + DATE (MM/DD/YYYY). Disclaimer:
"THIS EVIDENCE OF COMMERCIAL PROPERTY INSURANCE IS ISSUED AS A MATTER OF
INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE ADDITIONAL INTEREST NAMED BELOW.
THIS EVIDENCE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE
COVERAGE AFFORDED BY THE POLICIES BELOW. THIS EVIDENCE OF INSURANCE DOES NOT
CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED REPRESENTATIVE OR
PRODUCER, AND THE ADDITIONAL INTEREST."

### Structured spec

#### Block A — Producer

| Field | Notes |
| --- | --- |
| PRODUCER NAME, CONTACT PERSON AND ADDRESS | Combined box |
| PHONE (A/C, No, Ext) / FAX (A/C, No) / E-MAIL ADDRESS | |
| CODE / SUB CODE | Agency codes |
| AGENCY CUSTOMER ID # | |

#### Block B — Company / policy identity

| Field | Notes |
| --- | --- |
| COMPANY NAME AND ADDRESS | Carrier legal name + address |
| NAIC NO | |
| "IF MULTIPLE COMPANIES, COMPLETE SEPARATE FORM FOR EACH" | Printed instruction — one carrier per form |
| POLICY TYPE | Write-in |
| LOAN NUMBER | Lender's loan # |
| POLICY NUMBER | |
| EFFECTIVE DATE / EXPIRATION DATE | |
| CONTINUED UNTIL TERMINATED IF CHECKED | Checkbox (evergreen policies) |
| THIS REPLACES PRIOR EVIDENCE DATED: | Supersession chain |

#### Block C — Insured & property

| Field | Notes |
| --- | --- |
| NAMED INSURED AND ADDRESS | |
| ADDITIONAL NAMED INSURED(S) | |
| PROPERTY INFORMATION — LOCATION / DESCRIPTION | "(ACORD 101 may be attached if more space is required)"; checkbox pair **BUILDING** OR **BUSINESS PERSONAL PROPERTY** |

#### Block D — Coverage information

Opens with the certification paragraph ("THE POLICIES OF INSURANCE LISTED BELOW
HAVE BEEN ISSUED TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD INDICATED …
LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS."), then:

| Row | Fields |
| --- | --- |
| PERILS INSURED | Checkboxes: BASIC · BROAD · SPECIAL |
| COMMERCIAL PROPERTY COVERAGE AMOUNT OF INSURANCE | $ amount + DED |

Then a YES / NO / N/A grid (each row is a 3-state check plus conditional fields):

| Row | Conditional fields |
| --- | --- |
| BUSINESS INCOME / RENTAL VALUE | If YES, LIMIT; checkbox "Actual Loss Sustained"; "# of months" |
| BLANKET COVERAGE | If YES, indicate value(s) reported on property identified above: $ |
| TERRORISM COVERAGE | "Attach Disclosure Notice / DEC" |
| — IS THERE A TERRORISM-SPECIFIC EXCLUSION? | Y/N/N-A |
| — IS DOMESTIC TERRORISM EXCLUDED? | Y/N/N-A |
| LIMITED FUNGUS COVERAGE | If YES, LIMIT + DED |
| FUNGUS EXCLUSION | "(If \"YES\", specify organization's form used)" |
| REPLACEMENT COST | Y/N/N-A |
| AGREED VALUE | Y/N/N-A |
| COINSURANCE | If YES, % |
| EQUIPMENT BREAKDOWN (If Applicable) | If YES, LIMIT + DED |
| ORDINANCE OR LAW — Coverage for loss to undamaged portion of bldg | If YES, LIMIT + DED |
| — Demolition Costs | If YES, LIMIT + DED |
| — Incr. Cost of Construction | If YES, LIMIT + DED |
| EARTH MOVEMENT (If Applicable) | If YES, LIMIT + DED |
| FLOOD (If Applicable) | If YES, LIMIT + DED |
| WIND / HAIL | INCL checkbox + YES/NO "Subject to Different Provisions:"; If YES, LIMIT + DED |
| NAMED STORM | INCL checkbox + YES/NO "Subject to Different Provisions:"; If YES, LIMIT + DED |
| PERMISSION TO WAIVE SUBROGATION IN FAVOR OF MORTGAGE HOLDER PRIOR TO LOSS | Y/N/N-A |

**UNVERIFIED:** whether the 2016/03 edition carries a general REMARKS box. Neither
the NY DFS official text nor the field-extraction census I reviewed shows one
(overflow is routed to ACORD 101 from the Property Information caption). Confirm on
a licensed blank before assuming remarks space exists.

#### Block E — Cancellation & additional interest (footer)

| Field | Notes |
| --- | --- |
| CANCELLATION | "SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE EXPIRATION DATE THEREOF, NOTICE WILL BE DELIVERED IN ACCORDANCE WITH THE POLICY PROVISIONS." |
| ADDITIONAL INTEREST — NAME AND ADDRESS | The mortgagee/lender box |
| Interest-type checkboxes | MORTGAGEE · LENDER'S LOSS PAYABLE · LOSS PAYEE · CONTRACT OF SALE |
| LENDER SERVICING AGENT NAME AND ADDRESS | |
| AUTHORIZED REPRESENTATIVE | Signature |
| Edition/copyright | "ACORD 28 (2016/03)" · "© 2003-2016 ACORD CORPORATION. All rights reserved." |

### Fit with the existing code

ACORD 28 does not decompose into ACORD 25-style coverage sections: it is one
property coverage block plus a long conditional YES/NO/N-A grid. A descriptor
layer for it would look like a list of `{ key, label, answer: yes|no|na, limit?,
ded?, extra? }` rows rather than `SectionDef`s — the accuracy contract carries over
directly (an answer is only earned if the policy form set backs it; N/A is the
honest default for coverages the schedule says nothing about).

---

## 3. Verified NAIC Company Codes

Method: every code below is confirmed against at least one authoritative source —
AM Best rating disclosures (ratings.ambest.com), state DOI company directories
(NY DFS, CA DOI, NJ DOBI, FL OIR, DE DOI exam reports), surplus lines stamping
offices (SLTX), or the carrier's own statutory disclosure page. Codes that could
not be confirmed are marked **UNVERIFIED — do not use**. Remember the ACORD-28
lesson from the field guides: list the *issuing carrier's* legal name and NAIC
code, never the MGA's.

| Brand / group | Writing company (legal name) | NAIC | Notes | Source | Confidence |
| --- | --- | --- | --- | --- | --- |
| Kinsale | Kinsale Insurance Company | **38920** | E&S carrier, all 50 states surplus lines; Kinsale Capital Group | [AM Best AMB 014027](https://ratings.ambest.com/CompanyProfile.aspx?AltNum=176714027&ambnum=14027) · [SLTX evaluation](https://www.sltx.org/Insurers/Summaries/38920_Kinsale%20Insurance%20Company.pdf) | High |
| Markel (E&S) | Evanston Insurance Company | **35378** | Markel's surplus-lines writer (all 50 states + DC). Successor by merger to Essex Insurance Company (merged 6/30/2016; Essex is ineligible/retired — never issue on Essex paper) | [markel.com company list](https://www.markel.com/our-insurance-companies) · [AM Best AMB 003759](https://ratings.ambest.com/CompanyProfile.aspx?AltNum=14573759&ambnum=3759) · [Insurance Journal on the merger](https://www.insurancejournal.com/news/southcentral/2016/09/19/426933.htm) | High |
| Markel (admitted) | Markel Insurance Company | **38970** | Admitted, IL-domiciled (f/k/a Insurance Company of Evanston — distinct from Evanston Insurance Company) | [AM Best AMB 002699](https://ratings.ambest.com/companyprofile.aspx?AltNum=23112699&ambnum=2699) · [NY DFS directory](https://myportal.dfs.ny.gov/companydirectory/svas_det.jsp?filekey=dir&frst=dir_srch_optiono&search_type=CPAT_NUM&search_value=301) · [CA DOI profile](https://interactive.web.insurance.ca.gov/companyprofile/companyprofile?doFunction=getCompanyProfile&eid=55231&event=companyProfile) | High |
| Markel (admitted, specialty/personal) | Markel American Insurance Company | **28932** | Admitted, VA-domiciled | [markel.com company list](https://www.markel.com/our-insurance-companies) (company's own statutory disclosure page) | High (single source) |
| AmTrust | Technology Insurance Company, Inc. | **42376** | DE-domiciled AmTrust writing company (WC-heavy). AmTrust has many other writing companies (Wesco, Security National, AmTrust Ins Co of KS, etc.) — always read the dec page | [NY DFS directory](https://myportal.dfs.ny.gov/companydirectory/dir_det.jsp?filekey=dir&frst=dir_srch_optiono&search_type=CPAT_NUM&search_value=5555) · [CA DOI profile](https://interactive.web.insurance.ca.gov/companyprofile/companyprofile?doFunction=getCompanyProfile&eid=62931&event=companyProfile) · [AM Best AMB 011234](https://ratings.ambest.com/disclosurepdf.aspx?ambnum=11234) | High |
| Hiscox | Hiscox Insurance Company Inc. | **10200** | Admitted, IL-domiciled (f/k/a American Live Stock Insurance Company); Hiscox Inc. is the general agent, not the carrier | [hiscox.com](https://www.hiscox.com/about-hiscox-insurance) · [NY DFS directory](https://myportal.dfs.ny.gov/companydirectory/svas_det.jsp?filekey=dir&frst=dir_srch_optiono&search_type=NAIC&search_value=10200) · [CA DOI profile](https://interactive.web.insurance.ca.gov/companyprofile/companyprofile?doFunction=getCompanyProfile&eid=3358&event=companyProfile) | High |
| USLI | United States Liability Insurance Company | **25895** | Berkshire Hathaway group. Sister writers Mount Vernon Fire Insurance Company and U.S. Underwriters Insurance Company also issue USLI paper — their codes were **not verified** in this pass (UNVERIFIED — do not use until confirmed) | [AM Best AMB 002541](https://ratings.ambest.com/DisclosurePDF.aspx?AMBNum=2541) · [USLI-hosted Best's report](https://insurance.usli.com/media/e5kpuejc/usli-am-best.pdf) | High |
| Coterie (MGA — no NAIC code of its own) | Spinnaker Insurance Company | **24376** | IL-domiciled, admitted all 50 + DC; Hippo Holdings subsidiary | [Coterie partner FAQ](https://explore.coterieinsurance.com/partner-faqs) · [Spinnaker statutory page](https://spinnakerins.com/statutory-information) · [AM Best AMB 022321](https://ratings.ambest.com/DisclosurePDF.aspx?AMBNum=22321&PCA=0) | High |
| Coterie (MGA) | Benchmark Insurance Company | **41394** | KS-domiciled admitted carrier (Benchmark Insurance Group / Trean) | [Coterie partner FAQ](https://explore.coterieinsurance.com/partner-faqs) · [AM Best AMB 011205](https://ratings.ambest.com/companyprofile.aspx?AltNum=94511205&ambnum=11205) · [NJ DOBI carrier list](https://nj.gov/dobi/data/inscomp.htm) | High |
| Coterie (MGA) | Clear Spring Property and Casualty Company | **15563** | Group 1001; Coterie's FL writer per its appetite guide | [Coterie Ivans page](https://coterieinsurance.com/ivans-commercial-lines-downloads-for-coterie-insurance-agents/) · [NJ DOBI carrier list](https://nj.gov/dobi/data/inscomp.htm) · [FL OIR company list](https://floir.gov/docs-sf/default-source/property-and-casualty/flpropertycompaniescontact.pdf) | High |
| NEXT | Next Insurance US Company | **16285** | DE-domiciled; Munich Re group (d/b/a "Next American Insurance Company" in CA). NEXT also places some business through non-affiliated State National / National Specialty — read the dec page | [CA DOI profile](https://interactive.web.insurance.ca.gov/companyprofile/companyprofile?doFunction=getCompanyProfile&eid=111113&event=companyProfile) · [DE DOI exam report](https://insurance.delaware.gov/wp-content/uploads/sites/15/2023/06/NextInsuranceUSCompany2021web.pdf) · [nextinsurance.com licenses](https://www.nextinsurance.com/insurance-licenses/) | High |
| Progressive (flagship) | Progressive Casualty Insurance Company | **24260** | OH-domiciled; the group's flagship code. Progressive has dozens of writing companies — dec page governs | [AM Best AMB 002407](https://ratings.ambest.com/DisclosurePDF.aspx?AMBNum=2407) · [NY DFS directory](https://myportal.dfs.ny.gov/companydirectory/dir_det.jsp?c=c&filekey=dir&frst=dir_srch_optiono&naic=24260&search_type=CPAT_NUM&search_value=484) · [CA DOI profile](https://interactive.web.insurance.ca.gov/companyprofile/companyprofile?doFunction=getCompanyProfile&eid=5766&event=companyProfile) | High |
| Progressive (commercial auto) | United Financial Casualty Company | **11770** | OH-domiciled; Progressive's principal commercial-auto writing company — the code most likely to appear on commercial certs | [AM Best AMB 001900](https://ratings.ambest.com/DisclosurePDF.aspx?AMBNum=1900) · [CA DOI profile](https://interactive.web.insurance.ca.gov/companyprofile/companyprofile?doFunction=getCompanyProfile&eid=60985&event=companyProfile) | High |
| GEICO (flagship) | Government Employees Insurance Company | **22063** | MD-based, Berkshire Hathaway | [NY DFS DMV codes](https://www.dfs.ny.gov/consumers/auto_insurance/dmv_insurance_codes_and_contacts) · [FL OIR company list](https://floir.gov/docs-sf/default-source/property-and-casualty/flpropertycompaniescontact.pdf) | High |
| GEICO | GEICO Indemnity Company | **22055** | | same NY DFS / FL OIR sources | High |
| GEICO | GEICO General Insurance Company | **35882** | | [FL OIR company list](https://floir.gov/docs-sf/default-source/property-and-casualty/flpropertycompaniescontact.pdf) | High |
| GEICO | GEICO Casualty Company | **41491** | | same NY DFS / FL OIR sources | High |
| ISC (MGA — no NAIC code of its own) | Hadron Specialty Insurance Company | **17534** | E&S (domestic surplus lines), AR-domiciled; AM Best A- (Jul 2025); Hadron Holdings | [Hadron regulatory disclosures](https://hadroninsurance.com/regulatory-publications/) · [MSLA Bulletin 2023-24](https://www.msla.org/upload/insurer-updates/2023/2023-24%20Addition%20-%20Hadron%20Specialty%20Insurance%20Company.pdf) · [SLTX evaluation](https://www.sltx.org/Insurers/Summaries/17534_Hadron%20Specialty%20Insurance%20Company.pdf) | High |
| ISC (MGA) | Sutton National Insurance Company | **25798** | Admitted, OK-domiciled (f/k/a Unigard Indemnity Company); Sutton National Group 5065 | [MO DOI directory](https://insurance.mo.gov/insurance-company/sutton-national-insurance-company) · [CA DOI profile](https://interactive.web.insurance.ca.gov/companyprofile/companyprofile?doFunction=getCompanyProfile&eid=61809&event=companyProfile) · [AM Best AMB 020625](https://ratings.ambest.com/DisclosurePDF.aspx?AMBNum=20625&PCA=0) | High |
| ISC (MGA) | SiriusPoint America Insurance Company | **38776** | NY-domiciled (f/k/a Sirius America Insurance Company); SiriusPoint Group 5001 | [AM Best AMB 002642](https://ratings.ambest.com/CompanyProfile.aspx?AltNum=12732642&ambnum=2642) · [CA DOI profile](https://interactive.web.insurance.ca.gov/companyprofile/companyprofile?doFunction=getCompanyProfile&eid=6856&event=companyProfile) · [MS DOI search](https://apps.mid.ms.gov/licensing-search/company-search-results.aspx?LicNbr=8300044) | High |
| ISC (MGA) | Third Coast Insurance Company | **10713** | WI-domiciled; AmeriTrust Group (Blue Cross Blue Shield of MI Mutual parent); AM Best A (Dec 2024) | [AM Best AMB 011876](https://ratings.ambest.com/DisclosurePDF.aspx?AMBNum=11876&PCA=0) · [NAIC company listing](https://content.naic.org/sites/default/files/publication-loc-zu-listing-companies-summary.pdf) · [SLTX evaluation](https://www.sltx.org/Insurers/Summaries/10713_Third%20Coast%20Insurance%20Company.pdf) | High |

Additional MGA note on ISC: ISC (Instant Specialty, iscmga.com) is a managing
general agent — it holds no carrier license and no NAIC company code. The desk's
ISC policies issue on one of the four writers above; **the dec page governs which
one**, so the desk records the writing company per policy (`issuingCarrier`) at
intake and never infers it from the brand. An ISC policy with no recorded writer
prints a blank NAIC cell (codes retrieved Aug 2026).

Additional MGA note on Coterie: Coterie itself is a managing general agent /
insurtech, founded 2018, Cincinnati OH — it holds no carrier license and no NAIC
company code. Its own partner FAQ and Ivans download page (both retrieved Aug 2026)
list exactly the three issuing carriers above. Clear Blue Insurance Company
(NAIC 28860) circulates in older commentary but is **not** on Coterie's current
carrier list — do not attach it to Coterie without a policy document showing it.

GEICO caveat: GEICO is essentially a personal-lines direct writer; a commercial
certificate naming GEICO paper is unusual (commercial-ish affiliates such as GEICO
Marine exist but were not verified here — UNVERIFIED, do not use those codes).

---

## 4. Future Direction — Aviation Certificate Forms (brief)

ACORD publishes two dedicated aviation certificates, both current at edition
2016/03 per the official Forms Index: **ACORD 20, Certificate of Aviation Liability
Insurance** (liability-only aviation risks — airport/FBO/premises liability) and
**ACORD 21, Certificate of Aircraft Insurance** (hull + liability on specific
aircraft). ACORD 21 is the one with the aircraft identity block the desk would care
about: an AIRCRAFT INFORMATION section carrying **YEAR / MAKE / MODEL / SERIAL
NUMBER / REGISTRATION NUMBER** (the FAA "N-number", i.e. tail number), a checkbox
for "ACORD 333, Aircraft Schedule attached" for fleets/scheduled aircraft, coverage
rows split HULL & LIABILITY vs LIABILITY ONLY with options like Ground & Flight and
War Risks, per-aircraft hull values and liability limits (each occurrence / each
passenger / aggregate), plus the familiar ADDITIONAL INSURED? / SUBROGATION WAIVED?
flags. A real-world specimen (Otter/flyotter COI) shows the pattern: ACORD 21 with
an attached schedule listing each aircraft's N-number, year/make/model, serial,
crew/pax counts, hull value, and liability limit. In this repo's terms, an ACORD 21
descriptor would be a per-aircraft row model (identity cells + hull/liability limit
slots) rather than fixed coverage sections — closer to a schedule than to
`SECTION_DEFS`. Application-side siblings (ACORD 330 Aircraft Section, ACORD 333
Aircraft Schedule) exist for the submission workflow.

---

## Sources

ACORD official:

- [ACORD Forms Index (acord.org, PDF)](https://www.acord.org/docs/default-source/forms/forms_index.pdf) — current editions: ACORD 20 (2016/03), 21 (2016/03), 24 (2016/03), 25 (2025/12), 27 (2016/03), 28 (2016/03), 30 (2016/03), 31 (2016/03)
- [ACORD Certificates FAQ (acord.org)](https://www.acord.org/docs/default-source/forms/acordcertificatesfaq)
- [ACORD Forms Notification bulletin, December 2025 (acord.org, PDF)](https://www.acord.org/docs/default-source/forms/forms-notifications/acord-forms-notification-december-2025.pdf) — ACORD 25 (2025/12) change list

ACORD 28:

- [NY DFS-hosted official ACORD 28 (2016/03) PDF](https://www.dfs.ny.gov/system/files/documents/2021/02/acord_28_2016-03.pdf) — primary layout source
- [Sonant ACORD 28 field-by-field guide](https://www.sonant.ai/blog/acord-28) — secondary; usage context
- [Instafill ACORD 28 field census](https://instafill.ai/forms/acord-28-evidence-of-commercial-property-insurance) — 159 fields / 1 page

ACORD 30:

- [ACORD 30 (2010/12) blank, BSR Insurance–hosted PDF](https://bsrinsurance.com/BSRIforms/ACORD%2030%20Garage%20Insurance%20Certificate.pdf) — full prior-edition text
- [Filled ACORD 30 (2016/03) specimen, State of Colorado procurement portal](https://www.bidscolorado.com/co/portal.nsf/xsp/.ibmmodres/domino/OpenAttachment/CN=GSSBIDS3/O=CO_STATE!!co/PriceAwd.nsf/5B4EEE5B35415637872589FE005E168D/PASolicitationInsuranceFiles/Pueblo%20Dodge%20COI%202023%202024.pdf) — 2016/03 footer + garagekeepers layout
- [Filled ACORD 30 (2016/03) acroform text (Scribd)](https://www.scribd.com/document/834687409/ACORD-0030-2016-03-Acroform-1)
- [Ellie Insurance ACORD 30 guide](https://ellieinsurancegroup.com/resources/how-to-read-acord-30-certificate-of-garage-insurance) — box-by-box explanation, garagekeepers basis semantics (citing IRMI)
- [acordform.net ACORD 30 page](https://acordform.net/acord-30-form/) — edition metadata

Aviation:

- [Filled ACORD 21 (2016/03) specimen with aircraft schedule (flyotter.com)](https://www.flyotter.com/files/resources/COI.pdf)
- [acordform.net ACORD 21 blank text](https://acordform.net/wp-content/uploads/2025/04/ACORD-21-certificate.pdf)

NAIC codes (per-row sources are linked in the table above): AM Best rating
disclosures (ratings.ambest.com); NY DFS company directory & DMV code list; CA DOI
company profiles; NJ DOBI licensed-carrier and surplus-lines lists; FL OIR company
contact list; DE DOI examination reports; SLTX insurer evaluations; carrier
statutory pages (markel.com, hiscox.com, spinnakerins.com, coterieinsurance.com,
nextinsurance.com, geico.com).

*Compiled 2026-08-06. Web sources retrieved same day.*

---

## 5. ACORD 25 Edition Swap — 2016/03 → 2025/12, Verbatim Diff

Everything an implementer needs to move `src/components/CertificateStudio.tsx` /
`src/lib/acord25.ts` from ACORD 25 (2016/03) to ACORD 25 (2025/12) with zero
guesswork. Every 2025/12 quotation below was transcribed from an **authoritative
official copy**: the New York DFS approved-certificates library serves the actual
ACORD-authored 2025/12 specimen PDF (document metadata: Author "ACORD
Corporation", created 2025-10-02, produced by Silverlake Software Form Designer —
ACORD's forms production vendor; title "Approved Certificate of Insurance:
ACORD - ACORD 25 (2025/12) - Certificate of Liability Insurance"). Full page text
was extracted from that PDF and the rendered page was inspected visually, then
cross-checked against ACORD's own December 2025 Forms Notification change list.
The two sources agree on every point. 2016/03 text below is quoted from the
existing implementation, which section 5.6 confirms matches the real 2016/03.

**The official change list** (ACORD Forms Notification, December 2025 —
countrywide update, "filed and approved by all applicable States"):

1. Updated ACORD logo.
2. Edition marker changed from ACORD 25 (2016/03) to ACORD 25 (2025/12).
3. Copyright updated from "© 1988-2015 ACORD CORPORATION" to
   "© 1988-2025 ACORD CORPORATION".
4. Certification ("THIS IS TO CERTIFY") paragraph modified: (a) asterisk added
   before "LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS", (b) new sentence
   "LIMITS SHOWN ARE INCLUSIVE OF AMOUNTS REQUESTED BY THE CERTIFICATE HOLDER AND
   MAY NOT REFLECT POLICY LIMIT AMOUNTS IN EXCESS OF THOSE REQUESTED." added,
   (c) "*Not Applicable in WY" footnote added.
5. Coverages grid layout reformatted "with updated visual structure while
   maintaining the same data fields".

That is the complete list — **no other text block on the form changed.** The
verbatim comparison below confirms it.

### 5.1 The one changed paragraph — certification box (VERIFIED verbatim)

2016/03 (as implemented in `CertificateStudio.tsx`):

> THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE BEEN ISSUED
> TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD INDICATED. NOTWITHSTANDING ANY
> REQUIREMENT, TERM OR CONDITION OF ANY CONTRACT OR OTHER DOCUMENT WITH RESPECT
> TO WHICH THIS CERTIFICATE MAY BE ISSUED OR MAY PERTAIN, THE INSURANCE AFFORDED
> BY THE POLICIES DESCRIBED HEREIN IS SUBJECT TO ALL THE TERMS, EXCLUSIONS AND
> CONDITIONS OF SUCH POLICIES. LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS.

2025/12 (verbatim, NY DFS official copy):

> THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE BEEN ISSUED
> TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD INDICATED. NOTWITHSTANDING ANY
> REQUIREMENT, TERM OR CONDITION OF ANY CONTRACT OR OTHER DOCUMENT WITH RESPECT
> TO WHICH THIS CERTIFICATE MAY BE ISSUED OR MAY PERTAIN, THE INSURANCE AFFORDED
> BY THE POLICIES DESCRIBED HEREIN IS SUBJECT TO ALL THE TERMS, EXCLUSIONS AND
> CONDITIONS OF SUCH POLICIES. \*LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID
> CLAIMS. LIMITS SHOWN ARE INCLUSIVE OF AMOUNTS REQUESTED BY THE CERTIFICATE
> HOLDER AND MAY NOT REFLECT POLICY LIMIT AMOUNTS IN EXCESS OF THOSE REQUESTED.
> **\*Not Applicable in WY**

Exact mechanics, from the rendered official page: the first two sentences are
character-for-character identical to 2016/03. The asterisk is prepended directly
to "LIMITS" (no space: `*LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS.`).
The new sentence follows in the same paragraph. The footnote `*Not Applicable in
WY` prints **bold**, inside the same box, immediately after "…THOSE REQUESTED."
on the final line — it is not a page-bottom footnote. Big I NY's read of the
asterisk: "the last two sentences do not apply in the state of Wyoming."

Semantics (for the desk's fill policy): ACORD says the sentence "was added to
clarify existing industry practice … where a certificate holder requests
confirmation of specific amounts to satisfy a contract (say, $1M GL) and the
underlying policy carries more, the certificate may show the requested $1M rather
than the full limit" (ACORD statement via IIABA). It is permissive, not
mandatory; both IIABA and Big I NY advise continuing to show the actual policy
declarations limits as E&O best practice — which is exactly what the resolver's
accuracy contract already does. **No resolver change needed.**

### 5.2 Footer / identity lines (VERIFIED verbatim)

| Line | 2016/03 | 2025/12 |
| --- | --- | --- |
| Edition marker | `ACORD 25 (2016/03)` | `ACORD 25 (2025/12)` |
| Copyright | `© 1988-2015 ACORD CORPORATION. All rights reserved.` | `© 1988-2025 ACORD CORPORATION. All rights reserved.` |
| Trademark line | `The ACORD name and logo are registered marks of ACORD` | unchanged |

Placement on the official 2025/12 page: bottom rule line carries
"ACORD 25 (2025/12)" at left and "© 1988-2025 ACORD CORPORATION. All rights
reserved." at right **on the same line**, with the trademark line centered
beneath. (The current implementation prints the copyright on its own line above
the edition line — that ordering doesn't match the official sheet in either
edition; fix it while touching the footer.)

Logo: the header wordmark is ACORD's redesigned corporate logo (plain spaced
letterforms, not the old italic serif mark). Exact artwork is ACORD's registered
mark — reproduce from a licensed blank, not from this document.

### 5.3 Every other text block — confirmed UNCHANGED (verbatim compared)

Each block below was compared character-for-character between the implemented
2016/03 text and the extracted official 2025/12 text. All identical:

| Block | Status |
| --- | --- |
| Title "CERTIFICATE OF LIABILITY INSURANCE" · "DATE (MM/DD/YYYY)" | unchanged — VERIFIED |
| Top disclaimer ("THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS CERTIFICATE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE AFFORDED BY THE POLICIES BELOW. THIS CERTIFICATE OF INSURANCE DOES NOT CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED REPRESENTATIVE OR PRODUCER, AND THE CERTIFICATE HOLDER.") | unchanged — VERIFIED |
| IMPORTANT paragraph ("IMPORTANT: If the certificate holder is an ADDITIONAL INSURED, the policy(ies) must have ADDITIONAL INSURED provisions or be endorsed. If SUBROGATION IS WAIVED, subject to the terms and conditions of the policy, certain policies may require an endorsement. A statement on this certificate does not confer rights to the certificate holder in lieu of such endorsement(s).") | unchanged — VERIFIED |
| PRODUCER / INSURED boxes; CONTACT NAME: · PHONE (A/C, No, Ext): · FAX (A/C, No): · E-MAIL ADDRESS: | unchanged — VERIFIED |
| INSURER(S) AFFORDING COVERAGE · NAIC # · INSURER A–F rows | unchanged — VERIFIED |
| COVERAGES · CERTIFICATE NUMBER: · REVISION NUMBER: strip | unchanged — VERIFIED |
| Grid headers: INSR LTR · TYPE OF INSURANCE · ADDL INSD · SUBR WVD · POLICY NUMBER · POLICY EFF (MM/DD/YYYY) · POLICY EXP (MM/DD/YYYY) · LIMITS | unchanged — VERIFIED |
| GL type cell: COMMERCIAL GENERAL LIABILITY (with leading checkbox) · CLAIMS-MADE / OCCUR · two unlabeled checkbox write-in rows (retained, visible on rendered page) · GEN'L AGGREGATE LIMIT APPLIES PER: · POLICY / PRO-JECT / LOC · OTHER: | unchanged — VERIFIED |
| GL limits: EACH OCCURRENCE · DAMAGE TO RENTED PREMISES (Ea occurrence) · MED EXP (Any one person) · PERSONAL & ADV INJURY · GENERAL AGGREGATE · PRODUCTS - COMP/OP AGG · spare $ row | unchanged — VERIFIED |
| Auto: AUTOMOBILE LIABILITY · ANY AUTO · OWNED AUTOS ONLY / SCHEDULED AUTOS · HIRED AUTOS ONLY / NON-OWNED AUTOS ONLY · COMBINED SINGLE LIMIT (Ea accident) · BODILY INJURY (Per person) · BODILY INJURY (Per accident) · PROPERTY DAMAGE (Per accident) · spare $ row | unchanged — VERIFIED |
| Umbrella: UMBRELLA LIAB / OCCUR · EXCESS LIAB / CLAIMS-MADE · DED / RETENTION $ · EACH OCCURRENCE · AGGREGATE · spare $ row | unchanged — VERIFIED |
| WC: WORKERS COMPENSATION AND EMPLOYERS' LIABILITY · Y / N · ANY PROPRIETOR/PARTNER/EXECUTIVE OFFICER/MEMBER EXCLUDED? · N / A · (Mandatory in NH) · If yes, describe under DESCRIPTION OF OPERATIONS below · PER STATUTE / OTH-ER · E.L. EACH ACCIDENT · E.L. DISEASE - EA EMPLOYEE · E.L. DISEASE - POLICY LIMIT | unchanged — VERIFIED |
| Additional blank write-in row under WC | present — VERIFIED |
| DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES (ACORD 101, Additional Remarks Schedule, may be attached if more space is required) | unchanged — VERIFIED |
| CERTIFICATE HOLDER · CANCELLATION ("SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE EXPIRATION DATE THEREOF, NOTICE WILL BE DELIVERED IN ACCORDANCE WITH THE POLICY PROVISIONS.") · AUTHORIZED REPRESENTATIVE | unchanged — VERIFIED |

No new checkboxes, no renamed limit lines, no changed ADDL INSD / SUBR WVD
headers, no new columns. ACORD's bulletin phrase "maintaining the same data
fields" is borne out block-by-block.

### 5.4 The grid reformat — visual only

The one structural change is cosmetic: on the rendered 2025/12 page the
checkboxes in each TYPE OF INSURANCE cell are arranged along a left rail (a
vertical stack of boxes at the cell's left edge, labels to the right) instead of
the 2016/03 inline checkbox-before-label arrangement, and row heights/borders in
the limits column are slightly regularized. Same checkboxes, same labels, same
count. `SECTION_DEFS` (typeCell / limitBoxes / limitsHead) needs **no data
change**. Exact box geometry for pixel-faithful rendering: confirm against a
licensed blank, per this document's standing accuracy note.

### 5.5 Implementer checklist for this repo

All in `src/components/CertificateStudio.tsx` (plus one doc comment):

1. Certification paragraph: prepend `*` to "LIMITS SHOWN MAY HAVE BEEN REDUCED…",
   append the new sentence, and render the bold `*Not Applicable in WY` footnote
   at the end of the same box (see §5.1 for exact text).
2. Footer: `© 1988-2015` → `© 1988-2025`; `ACORD 25 (2016/03)` →
   `ACORD 25 (2025/12)`; optionally fix line placement per §5.2.
3. Header logo: swap to the current ACORD wordmark (licensed artwork).
4. Doc comments referencing "(2016/03)" in `CertificateStudio.tsx` and
   `src/lib/acord25.ts` → "(2025/12)".
5. No changes to `SECTION_DEFS`, resolvers, verifier, or any grid label.

### 5.6 Confidence notes — what is and isn't verified

- **VERIFIED verbatim (safe to ship):** every text block above, both editions.
  The implemented 2016/03 text was itself validated in this pass: every block
  matches the official 2016/03 except the five bulletin changes — i.e. the
  extracted 2025/12 text differs from the implementation *only* at the bulletin's
  change points, which simultaneously confirms both the old transcription and the
  new one.
- **UNVERIFIED — do not ship from this document:** exact logo artwork (§5.2) and
  pixel-level box geometry of the reformatted grid (§5.4). Both need a licensed
  blank from the agency's forms provider or acord.org.
- **Out of scope / unknown:** the December 2025 bulletin also lists
  state-specific forms updates beyond the countrywide ACORD 25; those variants
  were not enumerated here. The NY DFS copy used above is the countrywide
  2025/12 form (the WY carve-out is handled inline via the asterisk footnote,
  not by a separate state edition).

### 5.7 Is 2016/03 still accepted during the transition?

- **ACORD license:** a replaced edition may be used for no more than 12 months
  after the new edition publishes — 2016/03 remains license-compliant until
  ~December 1, 2026, then becomes a license violation (Big I NY, citing ACORD's
  forms license; LegalClarity states the same 12-month transition).
- **New York is the hard case:** DFS added ACORD 25 (2025/12) to its approved
  certificates list (approval dated 2025-11-13) and removed 2016/03. Under NY
  Insurance Law Article 5 (§502), certificates furnished to **governmental
  entities** must be on approved forms — penalties $1,000 first offense / $2,000
  subsequent. PIANY's guidance: the 2016 edition "may no longer be used for
  certificates of insurance issued in New York state." Big I NY's more measured
  read: outside the governmental-entity scope the old form is "not illegal," but
  stop using it anyway.
- **Everywhere else:** most states have no approved-certificate-list regime, and
  ACORD filed 2025/12 as approved in all applicable states; in practice
  certificate holders continue accepting 2016/03 paper during the license window.
  Vendor lag is real — PIANY notes many agency management systems still
  defaulted to the 2016 edition months after release — so holders have been
  seeing both editions through 2026. Prudent desk policy: issue only 2025/12
  (this app controls its own template, so there is no vendor-lag excuse), accept
  incoming 2016/03 certs as evidence while the license window runs.

### 5.8 Sources for section 5

- [NY DFS official ACORD 25 (2025/12) specimen](https://www.dfs.ny.gov/apps-and-licensing/insurance-companies/certificates-approved/acord-25-2025-12-liability)
  — the authoritative full-text source; ACORD-authored PDF served from the DFS
  approved-certificates library (retrieved 2026-08-07)
- [NY DFS Approved Certificates of Insurance list](https://www.dfs.ny.gov/apps_and_licensing/insurance_companies/certificates_approved)
  — shows ACORD 25 (2025/12) approved 2025-11-13; 2016/03 no longer listed
- [ACORD Forms Notification, December 2025 (acord.org, PDF)](https://www.acord.org/docs/default-source/forms/forms-notifications/acord-forms-notification-december-2025.pdf)
  — official change list quoted at the top of this section (direct download is
  403-gated; change
  list obtained via search-engine snapshot and cross-verified against the DFS
  specimen)
- [IIABA VU: "Input from ACORD Regarding Recent Changes to the ACORD 25"](https://www.independentagent.com/vu_resource/input-from-acord-regarding-recent-changes-to-the-acord-25/)
  — ACORD's own explanation of the new limits sentence; advice to keep showing
  declarations limits
- [Big I New York: "ACORD Changes Limits Wording on Certificate of Insurance"](https://www.biginy.org/news/ask-tim-news/acord-changes-limits-wording-on-certificate-of-insurance/)
  — quotes both editions' certification wording; WY asterisk interpretation
- [Big I New York: "The Old ACORD Certificate Form Is Not Illegal. Stop Using It."](https://www.biginy.org/news/ask-tim-news/the-old-acord-certificate-form-is-not-illegal-stop-using-it/)
  — NY Article 5 / §502 analysis, 12-month ACORD license window
- [PIA Northeast notice via LinkedIn (Jamie Ferris)](https://www.linkedin.com/posts/jamieferris_urgent-update-to-all-ny-insurance-brokers-activity-7445854866955976704-7So5)
  — DFS removal of 2016/03, AMS vendor-lag warning
- [NY DFS Certificates of Insurance overview](https://www.dfs.ny.gov/apps_and_licensing/insurance_companies/certificates_of_insurance)
  — the Article 5 approval regime itself
- [LegalClarity: ACORD 25 form guide](https://legalclarity.org/certificate-of-liability-insurance-example-acord-25-form/)
  and [ACORD 25/125 processing guide](https://legalclarity.org/how-to-complete-and-submit-acord-forms-acord-25-and-125/)
  — secondary; 12-month transition framing

*Section 5 compiled 2026-08-07. Web sources retrieved same day.*
