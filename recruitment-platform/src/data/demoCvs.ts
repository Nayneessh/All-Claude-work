/**
 * Synthetic demo CVs — every name, employer, number and contact detail below is invented. They exercise different CV
 * layouts and edge cases (protected-attribute fields, a gap, an incomplete chronology, a short-experience profile).
 */

export interface DemoCv { key: string; fileName: string; text: string; note: string }

export const DEMO_CVS: DemoCv[] = [
  {
    key: 'aarav',
    fileName: 'Aarav_Mehta_CV.docx',
    note: 'Senior, complete, quantified; protected-attribute lines present',
    text: `AARAV MEHTA
VP – Procurement | Mumbai, India | aarav.mehta@example.com | +91 90000 00011
linkedin.com/in/aaravmehta-demo

PROFESSIONAL SUMMARY
Procurement leader with 18 years across automotive and steel manufacturing. Known for category strategy, supplier negotiations and procurement transformation.

EXPERIENCE
VP – Procurement, Orion Auto Components, Mumbai | Jan 2019 – Present
- Own category strategy and strategic sourcing programmes for ₹650 crore annual spend across 12 categories.
- Delivered 8.5% cost optimisation (₹55 crore savings) through renegotiated supplier contracts and should-cost modelling.
- Lead a procurement organisation of 45 people across 4 plants; built the vendor management framework covering 320 suppliers.
- Led procurement digitisation: eProcurement and supplier portal rollout, cutting PO cycle time by 40%.
Head of Sourcing, Helix Steel Ltd, Pune | 2013 – 2018
- Managed strategic sourcing for steel and metals inputs with annual spend of ₹420 crore.
- Reduced total cost of ownership by 6% through supplier consolidation, taking the supplier base from 600 to 310.
- Led a team of 22 buyers and negotiated long-term agreements with 15 strategic suppliers.
Senior Manager – Purchase, Alpha Industries, Pune | Jun 2008 – Dec 2012
- Handled vendor negotiations and import sourcing for manufacturing plants.
- Implemented SAP MM procurement processes, saving 3% annually.

EDUCATION
MBA (Operations), IIM Ahmedabad, 2008
B.E. Mechanical Engineering, College of Engineering Pune, 2003

CERTIFICATIONS
CPSM; Lean Six Sigma Green Belt

Date of Birth: 03 March 1982
Gender: Male
Marital Status: Married`,
  },
  {
    key: 'kavita',
    fileName: 'Kavita_Rao_Resume.docx',
    note: 'Solid mid-senior profile; company-first layout with date on its own line',
    text: `Kavita Rao
Mumbai | kavita.rao@example.com | +91 90000 00012

SUMMARY
Sourcing and supply chain professional with 14 years in manufacturing and consumer durables.

WORK EXPERIENCE
Head – Strategic Sourcing
Brightline Appliances Pvt Ltd, Mumbai
Apr 2017 – Present
• Manage category strategy and sourcing for appliances components; annual spend ₹380 crore.
• Achieved 5% savings (₹19 crore) via supplier negotiations and vendor rationalisation across 120 suppliers.
• Lead a team of 18 and introduced a supplier performance scorecard.
Manager – Procurement
Delta Engineering Works, Nashik
Aug 2011 – Mar 2017
• Handled vendor management and negotiations for fabricated components.
• Cut procurement lead time by 20% through supplier development.

EDUCATION
MBA (Marketing), Symbiosis Pune, 2011
B.Com, Mumbai University, 2009

SKILLS
Strategic sourcing, Negotiation, Vendor management, SAP, Category management`,
  },
  {
    key: 'rohan',
    fileName: 'Rohan_Desai_CV.pdf',
    note: 'Adjacent background (sales/marketing) — weak on procurement evidence',
    text: `ROHAN DESAI
Pune, India  rohan.desai@example.com  +91 90000 00013

PROFILE
Commercial manager with 16 years in sales and marketing for retail brands. Some exposure to purchasing for store fit-outs.

EXPERIENCE
Senior Marketing Manager, Zenith Retail, Pune          2016 - Present
- Led brand and trade marketing with a budget of ₹40 crore and a team of 12.
- Grew regional sales by 22% through channel expansion.
- Negotiated agency and media contracts, saving 4% on annual marketing spend.
Sales Manager, Aurora Consumer Products, Mumbai          2008 - 2015
- Managed key accounts across retail chains and delivered 15% growth.
- Handled purchasing of promotional merchandise.

EDUCATION
MBA (Marketing), Pune University, 2007
B.Com, Pune University, 2005`,
  },
  {
    key: 'meera',
    fileName: 'Meera_Iyer.docx',
    note: 'Strong evidence but education not stated → mandatory requirement needs verification',
    text: `MEERA IYER
Chennai | meera.iyer@example.com | +91 90000 00014

EXPERIENCE
Director – Procurement & Supply Chain, Vertex Automotive Systems, Chennai | Mar 2014 – Present
- Responsible for ₹900 crore annual procurement spend; set category strategy and sourcing plans for 18 categories.
- Delivered ₹70 crore of cost savings (7.8%) via supplier negotiations and should-cost analysis.
- Lead 60 people across procurement, supplier quality and logistics.
- Built supplier relationships with 25 strategic vendors; launched supplier development programme.
General Manager – Sourcing, Kestrel Steel Works, Chennai | 2006 - 2013
- Led strategic sourcing of steel inputs; spend of ₹500 crore.
- Reduced costs by 5% through consolidation and long-term agreements.

CERTIFICATIONS
CPSM`,
  },
  {
    key: 'vikram',
    fileName: 'Vikram_Singh_scan.pdf',
    note: 'Scanned PDF with no text layer — needs OCR, routed to manual review',
    text: ``,
  },
  {
    key: 'nisha',
    fileName: 'Nisha_Kulkarni_CV.docx',
    note: 'Good profile but only 9 years of relevant experience — verified mandatory failure',
    text: `NISHA KULKARNI
Bengaluru | nisha.kulkarni@example.com | +91 90000 00016

PROFESSIONAL SUMMARY
Procurement professional with 9 years in electronics manufacturing.

EXPERIENCE
Senior Manager – Procurement, Quanta Electronics, Bengaluru | Jan 2019 – Present
- Manage strategic sourcing of electronic components with annual spend of ₹300 crore.
- Delivered 7% cost reduction (₹21 crore) through supplier negotiations and vendor consolidation of 90 suppliers.
- Lead a team of 14 buyers.
Manager – Purchase, Photon Devices, Bengaluru | Feb 2015 – Dec 2018
- Handled vendor management and negotiations; saved 4% annually.

EDUCATION
MBA (Finance), Christ University, 2014
B.E. Electronics, RV College of Engineering, 2010`,
  },
  {
    key: 'arjun',
    fileName: 'Arjun_Nair_CV.docx',
    note: 'Senior, experienced; plausible borderline once evidence is thin on achievements',
    text: `ARJUN NAIR
Gurugram | arjun.nair@example.com | +91 90000 00017

EXPERIENCE
General Manager – Procurement, Crest Logistics Group, Gurugram | Jul 2012 – Present
- Responsible for sourcing and vendor management for transport and warehousing services.
- Lead a team of 20 and manage supplier contracts.
Deputy General Manager – Purchase, Sable Engineering, Delhi | May 2005 - Jun 2012
- Handled purchasing and negotiations for engineering inputs.

EDUCATION
MBA, Delhi University, 2005
B.Tech Mechanical, NIT, 2001`,
  },
  {
    key: 'sunita',
    fileName: 'Sunita_Pillai_CV.pdf',
    note: 'Experienced head of procurement; meets every mandatory gate',
    text: `SUNITA PILLAI
Pune | sunita.pillai@example.com | +91 90000 00018

EXPERIENCE
Head – Procurement, Zephyr Auto Systems, Pune | Aug 2016 – Present
- Responsible for category strategy and strategic sourcing for ₹520 crore annual spend in the automotive components business.
- Achieved 6% cost reduction (₹31 crore) through supplier negotiations and total cost of ownership analysis.
- Lead a team of 18 across sourcing and purchase operations.
General Manager – Purchase, Ardent Forgings, Nashik | Apr 2009 – Jul 2016
- Led sourcing of steel and forgings and negotiated long-term agreements with 12 strategic suppliers.
- Reduced input costs by 4% through vendor consolidation.
Manager – Procurement, Lumen Machinery, Pune | Jun 2006 – Mar 2009
- Handled purchasing and vendor negotiations for manufacturing units.

EDUCATION
MBA (Operations), SPJIMR Mumbai, 2006
B.E. Mechanical, Pune Institute of Technology, 2002`,
  },
  {
    key: 'harish',
    fileName: 'Harish_Bhatia_Resume.docx',
    note: 'Senior and qualified, but thin on quantified outcomes and strategy',
    text: `HARISH BHATIA
Delhi | harish.bhatia@example.com | +91 90000 00019

EXPERIENCE
Senior General Manager – Sourcing, Pinnacle Manufacturing, Delhi | Jan 2018 – Present
- Define category strategy and run strategic sourcing programmes for 9 categories with ₹280 crore annual spend.
- Achieved 5% cost reduction (₹14 crore) through supplier negotiations and manage 140 suppliers.
- Lead a team of 12 buyers; rolled out an eProcurement tool across 3 plants.
- Present procurement strategy to the leadership team and manage plant stakeholders.
Deputy General Manager – Purchase, Quartz Components, Gurugram | Jun 2011 – Dec 2017
- Responsible for purchase operations and vendor negotiations for auto components.
- Saved 3% through supplier negotiations.
Manager – Procurement, Rapid Tools, Noida | Mar 2008 - May 2011
- Purchasing of tooling and consumables.

EDUCATION
MBA, IMT Ghaziabad, 2008
B.Tech Mechanical, NIT Kurukshetra, 2004`,
  },
  {
    key: 'karan',
    fileName: 'Karan_Malhotra_CV.pdf',
    note: 'Almost no structured content — low extraction confidence routes to manual review',
    text: `KARAN MALHOTRA
Contact: karan.malhotra@example.com
Procurement professional with experience in sourcing across several companies. Details available on request.`,
  },
];

export const VP_PROCUREMENT_JD = `Vice President – Procurement

Role purpose
Lead the group's procurement function and deliver a step change in cost competitiveness, supplier performance and procurement capability across manufacturing businesses.

Key responsibilities
- Define and own category strategy and strategic sourcing programmes across direct and indirect spend.
- Deliver demonstrable cost optimisation and total-cost-of-ownership savings through supplier negotiations.
- Build and govern the vendor management framework, including supplier performance and risk.
- Lead a large procurement organisation and develop its leaders.
- Drive procurement transformation: digitisation, eProcurement and process improvement.

Requirements
- 15+ years of relevant procurement experience, with spend responsibility above ₹500 crore.
- MBA or equivalent postgraduate qualification.
- Experience in manufacturing; automotive or metals exposure preferred.
- CPSM or an equivalent procurement certification is preferred.
- Strong negotiation, stakeholder management and analytical skills.`;
