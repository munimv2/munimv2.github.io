// Paste-Safe test set: 30 made-up requests of the kind people paste into a
// chat AI, each with every private string labelled. Every person, company,
// address, email, phone number and account number here is invented (company
// names are the usual sample names such as Northwind Traders and Contoso).
// "names" are people, organizations and places the model has to find;
// "details" are contact details and numbers the patterns have to find.
// Some messages are meant to be hard: lower-case names, names that are also
// ordinary words, and names from outside the model's English news training.

export const CASES = [
  {
    id: 1,
    text: `Hi Maria, following our call, here is the brief for Northwind Traders. Their CFO, Daniel Okafor, wants the newsletter to explain the move from Leeds to Rotterdam.`,
    names: ["Maria", "Northwind Traders", "Daniel Okafor", "Leeds", "Rotterdam"],
    details: [],
  },
  {
    id: 2,
    text: `Can you tighten this cover letter for Priya Raghunathan? She is applying to Fabrikam in Bangalore and her referee is Tom Whitfield.`,
    names: ["Priya Raghunathan", "Fabrikam", "Bangalore", "Tom Whitfield"],
    details: [],
  },
  {
    id: 3,
    text: `Summarise the complaint from Mr. Kowalczyk about the delayed shipment from our Gdansk warehouse. Reply to him at piotr.kowalczyk@contoso.example.`,
    names: ["Kowalczyk", "Gdansk"],
    details: ["piotr.kowalczyk@contoso.example"],
  },
  {
    id: 4,
    text: `Draft a polite chaser to Siobhán Ní Bhriain at Bluefin Analytics in Galway. The invoice was due on 3 October.`,
    names: ["Siobhán Ní Bhriain", "Bluefin Analytics", "Galway"],
    details: [],
  },
  {
    id: 5,
    text: `Rewrite this so it sounds friendlier: "Oluwaseun, the Lagos office still has not sent the Q3 numbers to Adeyemi & Partners."`,
    names: ["Oluwaseun", "Lagos", "Adeyemi & Partners"],
    details: [],
  },
  {
    id: 6,
    text: `Meeting notes: Zhang Wei from Lumen Logistics confirmed the Shenzhen supplier. Next call with Zhang on Tuesday.`,
    names: ["Zhang Wei", "Lumen Logistics", "Shenzhen", "Zhang"],
    details: [],
  },
  {
    id: 7,
    text: `please make this email shorter. tell james that the harbourview contract is signed and karen will send the keys.`,
    names: ["james", "harbourview", "karen"],
    details: [],
  },
  {
    id: 8,
    text: `Translate for our client in Lyon: Madame Dubois, your appointment with Dr. Laurent Mercier is confirmed for Monday.`,
    names: ["Lyon", "Dubois", "Laurent Mercier"],
    details: [],
  },
  {
    id: 9,
    text: `Write a LinkedIn post congratulating Aisha Bello on joining Tailspin Toys in Austin. Her manager will be Ricardo Alves.`,
    names: ["Aisha Bello", "Tailspin Toys", "Austin", "Ricardo Alves"],
    details: [],
  },
  {
    id: 10,
    text: `Summarise this thread. Jonas Becker (Becker Haustechnik GmbH, Stuttgart) disputes the quote. You can reach him on +49 711 2345 678.`,
    names: ["Jonas Becker", "Becker Haustechnik GmbH", "Stuttgart"],
    details: ["+49 711 2345 678"],
  },
  {
    id: 11,
    text: `Help me reply to Hannah. She wants to know if Riverside Dental can move her husband Mark's cleaning from Thursday to Friday.`,
    names: ["Hannah", "Riverside Dental", "Mark"],
    details: [],
  },
  {
    id: 12,
    text: `Proofread: "Dear Mr Nguyen, Contoso Pharmacy in Hanoi has received your order. Kind regards, Linh Tran."`,
    names: ["Nguyen", "Contoso Pharmacy", "Hanoi", "Linh Tran"],
    details: [],
  },
  {
    id: 13,
    text: `Make this sound more professional: hey, Rob from Alpine Ski Rentals in Innsbruck says the deposit is late. call him on +43 512 123 456.`,
    names: ["Rob", "Alpine Ski Rentals", "Innsbruck"],
    details: ["+43 512 123 456"],
  },
  {
    id: 14,
    text: `Draft a reference letter for Fatima Zahra El Idrissi, who worked at Margie's Travel in Casablanca from 2021 to 2024.`,
    names: ["Fatima Zahra El Idrissi", "Margie's Travel", "Casablanca"],
    details: [],
  },
  {
    id: 15,
    text: `Bullet-point the key risks in this note from Ingrid Johansson, head of finance at Nordvik Shipping AS in Bergen. Wire details: IBAN NO93 8601 1117 947.`,
    names: ["Ingrid Johansson", "Nordvik Shipping AS", "Bergen"],
    details: ["NO93 8601 1117 947"],
  },
  {
    id: 16,
    text: `Write a short apology to Olivia Bennett. Our courier, Speedy Parcels, left her package in the wrong building in Manchester.`,
    names: ["Olivia Bennett", "Speedy Parcels", "Manchester"],
    details: [],
  },
  {
    id: 17,
    text: `Turn these notes into minutes: Kenji Watanabe (Sakura Foods) and Elena Petrova (Volga Trade) agreed to meet in Osaka in March.`,
    names: ["Kenji Watanabe", "Sakura Foods", "Elena Petrova", "Volga Trade", "Osaka"],
    details: [],
  },
  {
    id: 18,
    text: `Can you check the tone? "Dear Rose, Grant asked me to pass on that the Hope Street lease ends in June."`,
    names: ["Rose", "Grant", "Hope Street"],
    details: [],
  },
  {
    id: 19,
    text: `Explain this contract clause to my client, Mateo Fernández of Fernández e Hijos S.L. in Valencia, in plain words.`,
    names: ["Mateo Fernández", "Fernández e Hijos S.L.", "Valencia"],
    details: [],
  },
  {
    id: 20,
    text: `Write a thank-you note to the volunteers at Greenleaf Food Bank in Leicester, especially Deepak and Chloe.`,
    names: ["Greenleaf Food Bank", "Leicester", "Deepak", "Chloe"],
    details: [],
  },
  {
    id: 21,
    text: `Draft a payment reminder: Adventure Works Ltd owes us for the Denver workshop. Their AP contact is Sarah O'Connell, sarah.oconnell@adventure-works.example, +1 303-555-0186.`,
    names: ["Adventure Works Ltd", "Denver", "Sarah O'Connell"],
    details: ["sarah.oconnell@adventure-works.example", "+1 303-555-0186"],
  },
  {
    id: 22,
    text: `Summarise: Yusuf Demir called from the Izmir branch of Anatolia Textiles about the delayed dye order.`,
    names: ["Yusuf Demir", "Izmir", "Anatolia Textiles"],
    details: [],
  },
  {
    id: 23,
    text: `Help me write a LinkedIn recommendation for my former colleague Wiktoria Nowak, who led the data team at Coho Winery.`,
    names: ["Wiktoria Nowak", "Coho Winery"],
    details: [],
  },
  {
    id: 24,
    text: `Rephrase for a board update: we lost the Wingtip Toys account because Paul Harding moved to a competitor in Sydney.`,
    names: ["Wingtip Toys", "Paul Harding", "Sydney"],
    details: [],
  },
  {
    id: 25,
    text: `Write a gentle reminder to Mrs. Abernathy that her son Leo's school trip to Edinburgh needs a signed form by Friday.`,
    names: ["Abernathy", "Leo", "Edinburgh"],
    details: [],
  },
  {
    id: 26,
    text: `Our client Tailwind Legal LLP in Toronto wants a FAQ page. The partner in charge is Meera Iyer; the paralegal is Ben Carter.`,
    names: ["Tailwind Legal LLP", "Toronto", "Meera Iyer", "Ben Carter"],
    details: [],
  },
  {
    id: 27,
    text: `Translate into Spanish: Lucía, the van from Ruta Verde will pick up the flowers in Sevilla at 9.`,
    names: ["Lucía", "Ruta Verde", "Sevilla"],
    details: [],
  },
  {
    id: 28,
    text: `Check this message: "Hi Abdi, Kampala Coffee Exporters approved the sample. Please email abdi.hassan@kce.example with the shipping date."`,
    names: ["Abdi", "Kampala Coffee Exporters"],
    details: ["abdi.hassan@kce.example"],
  },
  {
    id: 29,
    text: `Make a to-do list from this voicemail: Gareth from Celtic Roofing in Cardiff needs the scaffolding permit before he can start on Number 12.`,
    names: ["Gareth", "Celtic Roofing", "Cardiff"],
    details: [],
  },
  {
    id: 30,
    text: `Shorten this: Ms. Takahashi asked whether Lakeshore Clinic can share her test results with Dr. Ahmed before her visit on the 14th.`,
    names: ["Takahashi", "Lakeshore Clinic", "Ahmed"],
    details: [],
  },
];
