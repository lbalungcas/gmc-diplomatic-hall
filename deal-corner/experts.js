/**
 * Everything the Deal Corner Experts page shows. Tracks 01–06 are word for word the landing page's
 * "Global Youth Priority Tracks" (index.html, #thematics); keep the two in step.
 *
 * A track with `experts: []` shows "Experts coming soon". To add an expert: run
 * `python scripts/build_deal_corner.py` for the photo (public/deal-corner/experts/<slug>.jpg), then
 * add an entry here. `photo: null` shows the expert's initials instead. `chip` is the short label in
 * the sticky track bar. Bios are plain text;
 * `blurb` is trusted markup copied from the landing page. An expert may sit on more than one track;
 * the hero count counts them once.
 */

// On Track 02 and Track 05.
const AMINA_MONI = {
  slug: 'amina-moni',
  name: 'Dr. Amina Moni',
  role: 'Regional Advocacy and Youth Civic Engagement Advisor',
  org: 'Plan International Asia Pacific',
  photo: 'amina-moni.jpg',
  bio: 'Dr. Amina Moni is a development professional with over 19 years of experience, serving as Regional Advocacy and Youth Civic Engagement Advisor at Plan International’s Asia Regional Office. She provides strategic support on advocacy, youth civic engagement, human rights programming, policy analysis, inclusive partnerships and strategic communication. Committed to children’s and young people’s rights at national, regional and international levels, she has worked with the British Council, ARTICLE 19, Educo, Save the Children and Plan International Bangladesh. She holds a PhD and MPhil in Government and Politics and a Master’s in Development Studies, and was a youth volunteer with UNICEF Bangladesh and Bangladesh Scouts.',
};

export const TRACKS = [
  {
    id: 'child-labour',
    no: '01',
    chip: 'Exploitation & Labour',
    name: 'Child Exploitation and Labour',
    icon: 'fa-briefcase',
    blurb: 'Youth-led actions to protect peers from exploitation and harmful work, keep children safely in school, and urge governments to enforce child labour laws.',
    target: 'Safe education & ending exploitation',
    experts: [
      {
        slug: 'eva-notte',
        name: 'Eva Notté',
        role: 'Technical Expert, Child Labour',
        org: 'Terre des Hommes Netherlands',
        photo: 'eva-notte.jpg',
        bio: 'Eva Notté is a pedagogical scientist and international criminologist, working as the Technical Expert on Child Labour at Terre des Hommes Netherlands. Her work focuses on children’s rights, with particular expertise, through her current PhD studies, in how the energy transition and the growing demand for critical minerals affect children in the Global South. She takes a child-centred approach, emphasising meaningful child participation in research, policy development and advocacy so that children’s experiences and perspectives inform decision-making.',
      },
      {
        slug: 'marielle-chico',
        name: 'Marielle DSJ. Chico',
        role: 'Program Officer',
        org: 'Consuelo Foundation',
        photo: 'marielle-chico.jpg',
        bio: 'Marielle “Elle” DSJ. Chico is a Program Officer at Consuelo Foundation and one of the focal officers for its Life Skills Plus (LS+) Program, which equips children and young people with skills for life, employability and adolescent reproductive health, grounded in positive youth development and a child rights-based approach. From 2020 to 2022 she was a Project Officer for a USAID-funded anti-human trafficking initiative implemented by the Partnership for Development Assistance in the Philippines (PDAP), working on prevention, survivor protection, prosecution and partnerships. She holds a BS in Development Communication from the University of the Philippines Los Baños and is pursuing an MA in Women and Development at UP Diliman.',
      },
    ],
  },
  {
    id: 'child-marriage',
    no: '02',
    chip: 'Child Marriage',
    name: 'Child, Early, and Forced Marriage',
    icon: 'fa-ring',
    blurb: 'Girl- and youth-led initiatives keeping girls in school safely, ending child marriage, and <strong>supporting young survivors to lead community change</strong>.',
    target: 'Girl-led advocacy & survivor leadership',
    experts: [
      {
        slug: 'arceu-honculada',
        name: 'Arceu James P. Honculada',
        role: 'Child’s Rights Programming Manager',
        org: 'Kindernothilfe (KNH) Philippines',
        photo: 'arceu-honculada.jpg',
        bio: 'Arceu James P. Honculada is a development professional and child rights advocate serving as the Child’s Rights Programming Manager of Kindernothilfe (KNH) in the Philippines. He provides strategic and technical leadership in child rights-based programming, with a focus on child protection, meaningful child participation and child-centred disaster risk reduction, working with civil society organisations and development partners to strengthen child protection systems. Beyond his professional role, James created Positive Parenting Matters, a digital advocacy platform with over 1.7 million followers that promotes positive parenting, healthy family relationships and nurturing environments where children can thrive.',
      },
      {
        slug: 'abby-roberts',
        name: 'Abby Roberts',
        role: 'Technical Expert, Sexual Exploitation of Children',
        org: 'Terre des Hommes Netherlands',
        photo: 'abby-roberts.jpg',
        bio: 'Abby Roberts is a strategic child protection specialist with over seven years of expertise in preventing and responding to the sexual exploitation of children. As Technical Expert on the Sexual Exploitation of Children at Terre des Hommes Netherlands, she provides high-level guidance to ensure that global programmes, research and advocacy align with evidence-based best practice. Her career includes driving sector-wide standardisation across hotlines, law enforcement and industry partners through specialised training and focus groups, leading programme development, and influencing key global and EU policy and legislation.',
      },
      AMINA_MONI,
      {
        slug: 'erickson-name',
        name: 'Erickson B. Name, RSW',
        role: 'Strategic Innovations Manager',
        org: 'Consuelo Zobel Alger Foundation – Philippines',
        photo: 'erickson-name.jpg',
        bio: 'Erickson B. Name is a registered social worker and the Strategic Innovations Manager of Consuelo Zobel Alger Foundation – Philippines. He leads strategic partnerships and initiatives focused on child protection, strengthening local child protection systems and advancing children’s rights, working with government agencies, civil society organisations and communities to promote sustainable and responsive programmes for children and families. He is passionate about empowering young people, promoting meaningful youth participation, and supporting innovative solutions to prevent child, early and forced marriage.',
      },
    ],
  },
  {
    id: 'corporal-punishment',
    no: '03',
    chip: 'Corporal Punishment',
    name: 'Corporal Punishment',
    icon: 'fa-ban',
    blurb: 'Youth advocates standing up against violent discipline in schools and homes, promoting violence-free learning spaces and positive care.',
    target: 'Violence-free schools & legal prohibitions',
    experts: [
      {
        slug: 'bess-herbert',
        name: 'Bess Herbert',
        role: 'Senior Policy Adviser',
        org: 'ISPCAN',
        photo: 'bess-herbert.jpg',
        bio: 'Bess Herbert is an international expert on ending violence against children and child rights, with 25 years of advocacy that has helped drive legal, policy and practical progress for hundreds of millions of children, including global advances towards universal prohibition of corporal punishment and prevention-focused child protection systems. She is Senior Policy Adviser at ISPCAN, where she delivers the Rise Up Policy Forum initiative, and a guest lecturer on children’s rights and child protection at King’s College London. She previously worked in the World Health Organization’s Violence Prevention Unit, at the Global Partnership to End Violence Against Children, and with the Global Initiative to End All Corporal Punishment of Children.',
      },
      {
        slug: 'sabine-rakotomalala',
        name: 'Sabine Rakotomalala',
        role: 'Child Psychologist, Violence Prevention Unit',
        org: 'World Health Organization (WHO)',
        photo: 'sabine-rakotomalala.jpg',
        bio: 'Sabine Rakotomalala is a child psychologist with over 25 years of experience in child protection and psychosocial support, working at the World Health Organization’s Violence Prevention Unit. Previously with UNICEF, Terre des hommes and the Global Partnership to End Violence Against Children, she led major child protection and violence prevention initiatives, including the Mental Health and Psychosocial Support Network (2007), the Minimum Standards for Child Protection in Humanitarian Action (2012), the INSPIRE: Seven strategies for ending violence against children technical package (2016), and the Ministerial Conference on Ending Violence Against Children (2025).',
      },
    ],
  },
  {
    id: 'climate',
    no: '04',
    chip: 'Climate & Child Rights',
    name: 'Climate Change & Child Rights',
    icon: 'fa-cloud-sun',
    blurb: 'Youth-driven advocacy addressing the intersection of climate emergencies and children’s safety, ensuring environmental policies protect the most vulnerable.',
    target: 'Climate-resilient child protection',
    experts: [
      {
        slug: 'maria-stella-echano',
        name: 'Maria Stella “Telay” Echano',
        role: 'Country Manager',
        org: 'Kindernothilfe e.V. Philippines',
        photo: 'maria-stella-echano.jpg',
        bio: 'Maria Stella “Telay” Echano is a child rights and climate change advocate and development leader with extensive experience in programme engagement, strategic partnerships and organisational development. As Country Manager of Kindernothilfe Philippines, she advances integrated programming on children’s rights, child protection, climate change adaptation and community resilience, promoting child-centred, climate-responsive and rights-based approaches that recognise where climate vulnerabilities and child protection risks meet. She works with local partners, civil society, networks and development stakeholders to strengthen protective systems, advance climate justice, and promote children’s meaningful participation in building safer, more resilient communities.',
      },
    ],
  },
  {
    id: 'asrh',
    no: '05',
    chip: 'Adolescent SRH',
    name: 'Adolescent Sexual and Reproductive Health',
    icon: 'fa-heart-pulse',
    blurb: 'Youth-led programmes ensuring access to comprehensive, age-appropriate health education, services, and bodily autonomy for all adolescents.',
    target: 'Health access & bodily autonomy',
    experts: [AMINA_MONI],
  },
  {
    id: 'ocsea',
    no: '06',
    chip: 'OCSEA',
    name: 'Online Child Sexual Exploitation and Abuse',
    icon: 'fa-shield-halved',
    blurb: 'Youth-led peer awareness and digital safety efforts to protect peers from online abuse, break the silence, and demand safer platforms.',
    target: 'Platform accountability & peer digital safety',
    experts: [
      {
        slug: 'itsaraporn-daoram',
        name: 'Itsaraporn (A) Daoram',
        role: 'Regional Consultant, Asia and the Pacific',
        org: '5Rights Foundation',
        photo: 'itsaraporn-daoram.jpg',
        bio: 'Itsaraporn “A” Daoram is Regional Consultant for Asia and the Pacific at 5Rights Foundation, working to advance children’s rights in the digital environment across the region. Her work focuses on child rights, AI governance, Safety by Design, digital policy, and the meaningful participation of children and young people. She brings experience across civil society, academia, safeguarding and regional policy advocacy in Asia-Pacific.',
      },
      {
        slug: 'ha-ryong-jung',
        name: 'Ha Ryong Jung (Michael)',
        role: 'Crime Prevention and Criminal Justice Officer',
        org: 'United Nations Office on Drugs and Crime (UNODC)',
        photo: 'ha-ryong-jung.jpg',
        bio: 'Ha Ryong “Michael” Jung is a Crime Prevention and Criminal Justice Officer at the United Nations Office on Drugs and Crime, primarily supporting its portfolio on crimes and violence against children. An attorney specialising in children’s rights and child protection, he has worked with the UN, civil society, courts and government agencies on justice, the online space and the rule of law.',
      },
      {
        slug: 'vanessa-bautista',
        name: 'Vanessa Bautista',
        role: 'Advocacy and Survivor Leadership, Global Programs',
        org: 'International Justice Mission (IJM)',
        photo: 'vanessa-bautista.jpg',
        bio: 'Vanessa Bautista is a creative and bold advocate for survivors of violence around the world. She grew up in the Philippines, where she earned her bachelor’s degree and licence in social work, and is a survivor of childhood sexual abuse. She served as a survivor leader in Standing Together to Advocate Rights (now the Philippine Survivor Network) and as an Aftercare Fellow in 2018, helping to build the Global Survivor Network, whose Leadership Council she is a founding member of. She now works with the Advocacy and Survivor Leadership team in IJM Global Programs and lives in the United States. “Survivors’ voices need to be an integral part of developing programs and policies.”',
      },
    ],
  },
  {
    id: 'child-protection',
    no: '07',
    chip: 'Child Protection',
    name: 'Child Protection (CANE+D)',
    icon: 'fa-child-reaching',
    blurb: 'Youth-informed systems that prevent and respond to child abuse, neglect, exploitation and discrimination, linking children and families to protection services that work.',
    target: 'Stronger child protection systems & services',
    experts: [
      {
        slug: 'mary-grace-blando',
        name: 'Mary Grace Z. Blando, RSW',
        role: 'Project Development Officer IV, Policy, Research and Program Management Division',
        org: 'NCC OSAEC CSAEM',
        photo: 'mary-grace-blando.jpg',
        bio: 'Mary Grace Z. Blando, RSW, is a senior government social welfare and program management professional with more than a decade of public service in child protection, anti-trafficking, family welfare and gender-responsive programming. She serves as Project Development Officer IV in the Policy, Research and Program Management Division of the NCC OSAEC CSAEM, where she contributes to strategic planning, policy development, inter-agency coordination, advocacy and technical assistance for survivor-centred and family-focused initiatives.',
      },
    ],
  },
];

// The Deal Corner team, shown after the tracks; the lead first. Photos are in
// public/deal-corner/facilitators/, built by the same script.
export const FACILITATORS = [
  { slug: 'lance-balungcas', name: 'Lance Balungcas', role: 'Deal Corner Lead', photo: 'lance-balungcas.jpg' },
  { slug: 'chrisindah-khosuma', name: 'Chrisindah Janecilsky Khosuma', role: 'Deal Corner Facilitator', photo: 'chrisindah-khosuma.jpg' },
  { slug: 'keumala-dewi', name: 'Keumala Dewi', role: 'Deal Corner Facilitator', photo: 'keumala-dewi.jpg' },
  { slug: 'sd-gatchalian-gador', name: 'SD Gatchalian Gador', role: 'Deal Corner Facilitator', photo: 'sd-gatchalian-gador.jpg' },
];
