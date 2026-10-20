// The registration form as data. Shared by the public form and admin editor (React, imported
// via a relative path) and by the Edge Functions (Deno), so validation is identical everywhere.
// Keep this file free of Deno/DOM globals and of non-erasable TS syntax (no enums), because Node
// also imports it in scripts/seed-fake.mjs.
//
// Rich text in titles, descriptions, labels and text blocks uses a tiny Markdown subset:
//   **bold**   [link text](https://… or mailto:…)   "- " bullet lines   blank line = new paragraph

export type QuestionKind = 'short' | 'paragraph' | 'email' | 'phone' | 'number' | 'radio' | 'checkbox';

/** Registration columns a question can feed. full_name, email and age are mandatory. */
export type CoreField =
  | 'full_name' | 'preferred_name' | 'email' | 'phone' | 'organization' | 'category' | 'country' | 'nationality' | 'age';

export const CORE_FIELDS: { key: CoreField; label: string; kinds: QuestionKind[]; mandatory?: boolean }[] = [
  { key: 'full_name', label: 'Full name', kinds: ['short'], mandatory: true },
  { key: 'preferred_name', label: 'Preferred name', kinds: ['short'] },
  { key: 'email', label: 'Email (ticket is sent here)', kinds: ['email'], mandatory: true },
  { key: 'phone', label: 'Mobile number', kinds: ['phone', 'short'] },
  { key: 'organization', label: 'Organization', kinds: ['short'] },
  { key: 'category', label: 'Participant category', kinds: ['radio', 'short'] },
  { key: 'country', label: 'Country of residence', kinds: ['short'] },
  { key: 'nationality', label: 'Nationality', kinds: ['short'] },
  { key: 'age', label: 'Age (under-18s get the guardian consent step)', kinds: ['number'], mandatory: true },
];

export interface FormOption {
  label: string;
  /** Image URL shown under the option (absolute, or a path like /form/deal-corner.png). */
  image?: string;
  /** Radio questions only: section to jump to when chosen ('submit' ends the form). */
  goTo?: string;
}

export interface FormQuestion {
  type: 'question';
  id: string;
  kind: QuestionKind;
  label: string;
  help?: string;
  required: boolean;
  options?: FormOption[];
  /** Adds an "Other:" choice with a text box (radio/checkbox). */
  allowOther?: boolean;
  mapsTo?: CoreField;
}

export interface FormText {
  type: 'text';
  id: string;
  title?: string;
  body: string;
}

export type FormBlock = FormQuestion | FormText;

export interface FormSection {
  id: string;
  title?: string;
  description?: string;
  blocks: FormBlock[];
  /** Where to go after this section: another section id, 'submit', or unset = the next section. */
  next?: string;
}

export interface FormSchema {
  version: 1;
  sections: FormSection[];
}

/** radio → string, checkbox → string[]. "Other" answers are stored as "Other: <text>". */
export type Answer = string | string[];
export type Answers = Record<string, Answer>;

export const OTHER_PREFIX = 'Other: ';
export const SUBMIT = 'submit';

const LIMITS: Record<QuestionKind, number> = {
  short: 300, paragraph: 3000, email: 254, phone: 40, number: 10, radio: 1000, checkbox: 1000,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ()./-]{6,25}$/;

export const isEmail = (s: string | null | undefined): s is string => !!s && s.length <= 254 && EMAIL_RE.test(s);

export const questions = (schema: FormSchema): FormQuestion[] =>
  schema.sections.flatMap((s) => s.blocks.filter((b): b is FormQuestion => b.type === 'question'));

export const questionFor = (schema: FormSchema, field: CoreField) => questions(schema).find((q) => q.mapsTo === field);

/** Strips Markdown markers for plain-text contexts (CSV headers, emails, dropdowns). */
export const plainText = (s: string) =>
  s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

// ───────────────────────── navigation ─────────────────────────

/** Section to show after `section`, honouring "go to section" choices on radio questions. */
export function nextSectionId(schema: FormSchema, section: FormSection, answers: Answers): string {
  for (const b of section.blocks) {
    if (b.type !== 'question' || b.kind !== 'radio') continue;
    const chosen = b.options?.find((o) => o.label === answers[b.id]);
    if (chosen?.goTo) return chosen.goTo;
  }
  if (section.next) return section.next;
  const i = schema.sections.findIndex((s) => s.id === section.id);
  return schema.sections[i + 1]?.id ?? SUBMIT;
}

/** The sections a respondent actually passes through, in order. */
export function sectionPath(schema: FormSchema, answers: Answers): FormSection[] {
  const path: FormSection[] = [];
  const seen = new Set<string>();
  let current: FormSection | undefined = schema.sections[0];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    const next = nextSectionId(schema, current, answers);
    current = next === SUBMIT ? undefined : schema.sections.find((s) => s.id === next);
  }
  return path;
}

// ───────────────────────── validation ─────────────────────────

const isEmpty = (v: Answer | undefined) => v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === '');

export function validateAnswer(q: FormQuestion, value: Answer | undefined): string | null {
  if (value === undefined || isEmpty(value)) return q.required ? 'This is a required question.' : null;
  const blankOther = (v: string) => v.trim() === OTHER_PREFIX.trim();
  if (q.allowOther && (Array.isArray(value) ? value.some(blankOther) : blankOther(value))) {
    return 'Please fill in your "Other" answer.';
  }
  const labels = new Set((q.options ?? []).map((o) => o.label));
  const okChoice = (v: string) =>
    labels.has(v) || (!!q.allowOther && v.startsWith(OTHER_PREFIX) && v.length > OTHER_PREFIX.length);

  if (q.kind === 'checkbox') {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && okChoice(v))) return 'Please choose from the options.';
    return null;
  }
  if (typeof value !== 'string') return 'Invalid answer.';
  if (value.length > LIMITS[q.kind]) return `Please keep this under ${LIMITS[q.kind]} characters.`;
  switch (q.kind) {
    case 'radio':
      return okChoice(value) ? null : 'Please choose from the options.';
    case 'email':
      return isEmail(value.trim()) ? null : 'Please enter a valid email address.';
    case 'phone':
      return PHONE_RE.test(value.trim()) ? null : 'Please enter a valid mobile number, including the country code.';
    case 'number': {
      const n = Number(value.trim());
      return Number.isInteger(n) && n >= 1 && n <= 120 ? null : 'Please enter a whole number.';
    }
    default:
      return null;
  }
}

export function validateSection(section: FormSection, answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const b of section.blocks) {
    if (b.type !== 'question') continue;
    const err = validateAnswer(b, answers[b.id]);
    if (err) errors[b.id] = err;
  }
  return errors;
}

export interface CoreValues {
  full_name: string;
  preferred_name: string | null;
  email: string;
  phone: string | null;
  organization: string | null;
  category: string | null;
  country: string | null;
  nationality: string | null;
  age: number | null;
}

/** Values for the registration's core columns, read from the linked questions' answers. */
export function extractCore(schema: FormSchema, answers: Answers): CoreValues {
  const text = (f: CoreField) => {
    const q = questionFor(schema, f);
    const v = q ? answers[q.id] : undefined;
    const s = Array.isArray(v) ? v.join('; ') : v;
    return typeof s === 'string' && s.trim() ? s.trim() : null;
  };
  const age = Number.parseInt(text('age') ?? '', 10);
  return {
    full_name: text('full_name') ?? '',
    preferred_name: text('preferred_name'),
    email: (text('email') ?? '').toLowerCase(),
    phone: text('phone'),
    organization: text('organization'),
    category: text('category'),
    country: text('country'),
    nationality: text('nationality'),
    age: Number.isInteger(age) && age >= 1 && age <= 120 ? age : null,
  };
}

/**
 * Validates a whole submission against the schema. Only questions on the respondent's path
 * count (skipped Deal Corner questions aren't required). Returns the cleaned answers and the
 * values for the registration's core columns.
 */
export function validateSubmission(schema: FormSchema, raw: unknown) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const answers: Answers = {};
  for (const q of questions(schema)) {
    const v = input[q.id];
    if (typeof v === 'string') answers[q.id] = v.trim();
    else if (Array.isArray(v)) answers[q.id] = v.filter((x): x is string => typeof x === 'string').map((x) => x.trim());
  }

  const errors: Record<string, string> = {};
  const cleaned: Answers = {};
  for (const section of sectionPath(schema, answers)) {
    Object.assign(errors, validateSection(section, answers));
    for (const b of section.blocks) {
      if (b.type === 'question' && !isEmpty(answers[b.id])) cleaned[b.id] = answers[b.id];
    }
  }

  const core = extractCore(schema, cleaned);
  if (!core.full_name) errors[questionFor(schema, 'full_name')?.id ?? '_full_name'] ??= 'Please enter your full name.';
  if (!isEmail(core.email)) errors[questionFor(schema, 'email')?.id ?? '_email'] ??= 'Please enter a valid email address.';

  return { answers: cleaned, core, errors, ok: Object.keys(errors).length === 0 };
}

/** Problems that would make a schema unusable. The editor refuses to save while any exist. */
export function validateSchema(schema: FormSchema): string[] {
  const problems: string[] = [];
  if (!schema || !Array.isArray(schema.sections) || schema.sections.length === 0) return ['The form needs at least one section.'];
  const sectionIds = new Set<string>();
  const blockIds = new Set<string>();
  schema.sections.forEach((s, si) => {
    const where = `Section ${si + 1}`;
    if (!s.id || sectionIds.has(s.id)) problems.push(`${where} has a missing or duplicate id.`);
    sectionIds.add(s.id);
    s.blocks.forEach((b) => {
      if (!b.id || blockIds.has(b.id)) problems.push(`${where}: a block has a missing or duplicate id (${b.id || 'empty'}).`);
      blockIds.add(b.id);
      if (b.type === 'question') {
        if (!plainText(b.label)) problems.push(`${where}: a question has no text.`);
        if ((b.kind === 'radio' || b.kind === 'checkbox') && !(b.options?.length)) problems.push(`${where}: "${plainText(b.label)}" needs at least one option.`);
        if ((b.options ?? []).some((o) => !o.label.trim())) problems.push(`${where}: "${plainText(b.label)}" has an empty option.`);
        const labels = (b.options ?? []).map((o) => o.label.trim());
        if (new Set(labels).size !== labels.length) problems.push(`${where}: "${plainText(b.label)}" has duplicate options.`);
      }
    });
  });
  for (const s of schema.sections) {
    const targets = [s.next, ...s.blocks.flatMap((b) => (b.type === 'question' ? (b.options ?? []).map((o) => o.goTo) : []))];
    for (const t of targets) {
      if (t && t !== SUBMIT && !sectionIds.has(t)) problems.push(`A "go to section" points at a section that no longer exists.`);
    }
  }
  for (const f of CORE_FIELDS) {
    const mapped = questions(schema).filter((q) => q.mapsTo === f.key);
    if (mapped.length > 1) problems.push(`Only one question can be linked to "${f.label}".`);
    if (f.mandatory && (mapped.length === 0 || !mapped[0].required)) {
      problems.push(`A required question must be linked to "${f.label}".`);
    }
    if (mapped[0] && !f.kinds.includes(mapped[0].kind)) problems.push(`"${f.label}" must be linked to a question of type: ${f.kinds.join(' or ')}.`);
  }
  return [...new Set(problems)];
}

/** Human-readable answer for tables, CSV and the admin drawer. */
export const answerText = (v: Answer | undefined) => (v === undefined ? '' : Array.isArray(v) ? v.join('; ') : v);

// ───────────────────────── default form ─────────────────────────
// The Violence Ends With Us visitor pre-registration Google Form, reproduced as written.

const THEMES = [
  'Child Exploitation and Labour',
  'Child, Early, and Forced Marriage',
  'Corporal Punishment',
  'Climate Change & Child Rights',
  'Adolescent Sexual and Reproductive Health',
  'Online Child Sexual Exploitation and Abuse',
];
const opts = (labels: string[]): FormOption[] => labels.map((label) => ({ label }));

export const DEFAULT_FORM: FormSchema = {
  version: 1,
  sections: [
    {
      id: 's1',
      title: 'Violence Ends With Us: Visitor Pre-Registration Form for Youth Innovations Marketplace 2026',
      description: '**Key Day and Dates:** Tuesday, 17 November 2026\n**Venue:** Diplomatic Hall, Ground Level, Mariott Hotel, Manila, Philippines',
      blocks: [
        {
          type: 'text',
          id: 'intro',
          body:
            'Thank you for expressing your interest in our event!\n\n' +
            'Convened by the Violence Ends With Us, co-hosted by Terre des Hommes Netherlands and Kindernothilfe, and supported by the Federal Ministry for Economic Cooperation and Development (BMZ)  and the European Union, the **Youth Innovations Marketplace** will take place as a satellite event of the **2nd Global Ministerial Conference on Ending Violence Against Children** at the **Marriott Hotel Manila** on **17 November 2026**.\n\n' +
            'Visitors are **welcome to participate throughout the day and experience the full Marketplace agenda.** Explore the immersive presentations and innovative solutions developed by children and young people from around the world, and join us in co-creating stronger child protection systems across various thematic areas!\n\n' +
            'Visit our [**Official Website**](https://youthinnovationsmarketplace.org/) for more information about the schedule, event spaces, and virtual Marketplace. You can also contact us at [**violenceendswithus@gmail.com**](mailto:violenceendswithus@gmail.com) for further inquiries.',
        },
        {
          type: 'text',
          id: 'please_note',
          title: '**Please Note:**',
          body:
            '- All visitors are invited to fill out the pre-registration form before 8:00 PM Philippine Standard Time on Saturday, 14 November 2026. Registered visitors will receive a confirmation email from the organisers.\n' +
            '- To help guests find their way around, the organisers will provide a **treasure map** to guide them through the Youth Innovation Booths, Deal Corner, Policy Wall, Photo Booth, and other areas of the Marketplace.',
        },
      ],
    },
    {
      id: 's2',
      blocks: [
        { type: 'text', id: 'visitor_category_heading', title: '**Visitor Category**', body: '' },
        {
          type: 'question',
          id: 'category',
          kind: 'radio',
          label: 'Select your participation category:',
          required: true,
          mapsTo: 'category',
          options: opts([
            'I am a child / youth',
            'I am a parent / teacher',
            'I am a social worker, youth advocate from NGO / CSO',
            'I am a government practitioner',
            'I am a private sector representative',
          ]),
        },
        { type: 'question', id: 'organization', kind: 'short', label: 'Which organization or institution are you representing?', required: true, mapsTo: 'organization' },
        {
          type: 'question',
          id: 'attendance',
          kind: 'checkbox',
          label: 'Will you be attending this youth-led presentation **in person or virtually**',
          required: true,
          options: opts(['In person, at the Marriott Hotel Manila', 'I will visit virtual Youth Innovation Booth']),
        },
      ],
    },
    {
      id: 's3',
      title: '**Participant Information**',
      blocks: [
        { type: 'question', id: 'full_name', kind: 'short', label: 'Full Name', required: true, mapsTo: 'full_name' },
        { type: 'question', id: 'preferred_name', kind: 'short', label: 'Preferred Name', required: true, mapsTo: 'preferred_name' },
        { type: 'question', id: 'age', kind: 'number', label: 'Age', required: true, mapsTo: 'age' },
        { type: 'question', id: 'nationality', kind: 'short', label: 'Nationality', required: true, mapsTo: 'nationality' },
        { type: 'question', id: 'country', kind: 'short', label: 'Country of Residence', required: true, mapsTo: 'country' },
        { type: 'question', id: 'sex', kind: 'radio', label: 'Assigned Sex at Birth', required: true, options: opts(['Female', 'Male', 'Intersex']) },
        {
          type: 'question',
          id: 'gender',
          kind: 'radio',
          label: 'Gender Identity',
          required: true,
          allowOther: true,
          options: opts(['Woman', 'Man', 'Non-Binary', 'Prefer not to say']),
        },
        { type: 'question', id: 'email', kind: 'email', label: 'Email Address', required: true, mapsTo: 'email' },
        { type: 'question', id: 'phone', kind: 'phone', label: 'Mobile Number (with country code)', required: true, mapsTo: 'phone' },
      ],
    },
    {
      id: 's4',
      title: '**Youth Innovation Information**',
      blocks: [
        { type: 'question', id: 'thematic_focus', kind: 'checkbox', label: 'What the thematic focus of your youth-led project that you interested in?', required: true, options: opts(THEMES) },
        { type: 'question', id: 'thematic_reason', kind: 'paragraph', label: 'What drew you to this particular thematic area?', required: true },
        {
          type: 'question',
          id: 'spaces',
          kind: 'checkbox',
          label: 'Which part of Youth Innovations Marketplace spaces you interested to visit?',
          required: true,
          options: [
            {
              label: 'Interactive Youth Innovation Booth - over 20+ dedicated innovation stations where visitors can get hands-on learning experience with youth-led projects. Youth innovators will showcase their tools, digital reporting apps, community-based mechanisms, and other innovative solutions, while presenting tangible evidence of their impact in reducing violence against children.',
              image: '/form/youth-innovation-booth.png',
            },
            {
              label: 'Deal Corner - the heart of Marketplace connections and partnerships: a structured, youth-friendly space for targeted bilateral conversations between youth-led initiatives and potential partners. Moving beyond visibility toward concrete commitments for seed funding, technical mentorship, partnerships, and expansion or adoption of youth-led solutions.',
              image: '/form/deal-corner.png',
            },
            {
              label: 'Call to Action Corner - amplifying priorities articulated by children and youth across the Asia-Pacific region, including child labour; corporal punishment; child early and forced marriage; and online child sexual exploitation. Delegates can explore grassroots recommendations and endorse the official petition.',
              image: '/form/call-to-action-corner.png',
            },
            {
              label: 'Intergenerational Dialogue - a focused plenary conversation bringing together young innovators, government ministers, and global development partners to explore what it truly takes for grassroots solutions to inform and become institutional policies.',
              image: '/form/intergenerational-dialogue.png',
            },
            {
              label: 'Policy Wall - a dynamic visual mind map connecting showcased innovations with regional child protection frameworks. Delegates can identify opportunities for partnership, pledge institutional support, and map connections between grassroots solutions and statutory laws and policies.',
              image: '/form/policy-wall.png',
            },
            {
              label: 'Interactive Virtual Youth Innovation Booth - an online space showcasing youth-led innovations and solutions from across the world, enabling visitors to explore projects and engage with young innovators virtually.',
              image: '/form/virtual-youth-innovation-booth.png',
            },
          ],
        },
      ],
    },
    {
      id: 's5',
      blocks: [
        {
          type: 'text',
          id: 'morning_schedule',
          title: '**Morning Schedule**',
          body:
            '09:30 AM - 09:45 AM| **Welcome & Marketplace Opening**\n\n' +
            '09:45 AM - 12:30 AM|**Open Marketplace, Innovation Spotlights and Partner Connections**\n\n' +
            '11:15 AM - 11:30 AM|**Marketplace Energiser**',
        },
        {
          type: 'text',
          id: 'afternoon_schedule',
          title: '**Afternoon Schedule**',
          body:
            '01:30 PM - 01:40 PM | **Afternoon Welcome & Highlights**\n\n' +
            '01:40 PM - 14:15 PM | **Open Marketplace, Live Demonstrations and Partnership Connections**\n\n' +
            '02:45 PM - 15:16 PM | **Intergenerational Dialogue: From Youth Innovation to System Change**\n\n' +
            '03:15 PM - 16:15 PM | **Commitments & Connections**\n\n' +
            '04:15 PM - 16:30 PM | **Youth Reflection & Call to Action**',
        },
        {
          type: 'question',
          id: 'session',
          kind: 'checkbox',
          label: 'Which session do you intend to join?',
          required: false,
          options: opts(['Youth Innovations Marketplace - Morning Session', 'Youth Innovations Marketplace - Afternoon Session']),
        },
      ],
    },
    {
      id: 's6',
      blocks: [
        {
          type: 'text',
          id: 'deal_corner_intro',
          title: '**Deal Corner**',
          body:
            "Welcome to the Deal Corner, where the marketplace's most advanced youth-led partnerships are made!\n\n" +
            'Running alongside the interactive youth innovation booths and intergenerational dialogue, the Deal Corner is where young innovators step up to pitch their ideas with **potential funders, corporate partners, government representatives, and  other organisations that can help sustain and scale their innovations.**\n\n' +
            'Through pre-arranged meetings, youth teams and partners come together for focused conversations that spark real collaborations and open doors to new opportunities.\n\n' +
            'At the Deal Corner, every conversation is an opportunity to take the next step. Each meeting aims to establish clear follow-up plans, secure partner commitments, and build lasting support for youth-led teams and their innovations.',
        },
        {
          type: 'question',
          id: 'deal_corner_interest',
          kind: 'radio',
          label: 'Are you a government representative, private sector partner, civil society organisation (CSO), or youth organisation interested in taking part in the Deal Corner?',
          required: false,
          options: [
            { label: 'Yes, I am interested', goTo: 's7' },
            { label: 'No, I am not interested', goTo: 's8' },
          ],
        },
      ],
    },
    {
      id: 's7',
      title: 'Thank you for your interest in the Deal Corner!',
      blocks: [
        { type: 'question', id: 'deal_corner_topics', kind: 'checkbox', label: '**Which thematic topic are you interested for the match-making?**', required: false, allowOther: true, options: opts(THEMES) },
        {
          type: 'question',
          id: 'deal_corner_support',
          kind: 'checkbox',
          label: 'What kind of support are you interested on providing to youth innovator teams at the deal corner?',
          required: false,
          allowOther: true,
          options: opts([
            'Technical expertise',
            'Technology or digital resource',
            'Mentoring and/or coaching',
            'Policy and/or lobby engagements',
            'Innovation scale up, expansion and/or replications',
            'Implementation partnership',
          ]),
        },
        {
          type: 'question',
          id: 'deal_corner_followup',
          kind: 'radio',
          label: 'We will send you an invitation email with more details about the **Deal Corner**. Please let us know if you are available to receive this follow-up!',
          required: false,
          options: opts([
            'Yes, you can reach out to me by email for updates.',
            'Maybe, you can try to contact me through WhatsApp.',
            'No, I am not available to receive any emails.',
          ]),
        },
        {
          type: 'question',
          id: 'deal_corner_thoughts',
          kind: 'paragraph',
          label: 'Do you have any initial thoughts or suggestions for the organisers regarding your participation in the Deal Corner?\n(e.g., preferred meeting times, potential contributions or support you could offer, questions you may have, or any other information)',
          required: false,
        },
      ],
    },
    {
      id: 's8',
      title: '**Final Confirmation & Commitments**',
      description: 'Before submitting your application, please review and confirm the statements below. These will help ensure clarity and shared expectations for all participants and organisers.',
      blocks: [
        {
          type: 'question',
          id: 'guest_confirmation',
          kind: 'checkbox',
          label: '**Guest Confirmation**',
          required: true,
          options: opts(['I confirm my participation in the in-person and/or online booth of Youth Innovations Marketplace on 17 November 2026.']),
        },
        {
          type: 'question',
          id: 'safeguarding',
          kind: 'checkbox',
          label: '**Safeguarding & Code of Conduct**',
          required: true,
          options: opts(['I agree to uphold safeguarding standards and to participate in a respectful, inclusive, and youth-friendly manner throughout the event.']),
        },
        { type: 'text', id: 'safeguarding_note', body: '**Please note:** The full Safeguarding Policy and Code of Conduct will be shared with visitors prior to the satellite event.' },
        {
          type: 'question',
          id: 'accuracy',
          kind: 'checkbox',
          label: '**Accuracy of Information**',
          required: true,
          options: opts(['I confirm that the information provided in this registration form is accurate to the best of my knowledge.']),
        },
        {
          type: 'question',
          id: 'communications',
          kind: 'checkbox',
          label: '**Contact & Communications**',
          required: true,
          options: opts(['I agree to be tagged in the calendar invites and contacted by the Violence Ends With Us regarding the confirmation and agenda of Youth Innovations Marketplace.']),
        },
      ],
    },
    {
      id: 's9',
      title: '**Thank You**',
      description:
        'Thank you for confirming your participation in the **Youth Innovations Marketplace,** a satellite event for the 2nd Global Ministerial Conference on Ending Violence Against Children.\n\n' +
        'We are deeply encouraged by the enthusiasm, commitment, and leadership in advancing youth-led solutions around the world! Your participation is an important step towards building a stronger, more collaborative, youth-led movement to end violence against children.\n\n' +
        'For any questions or clarification, please contact us through our [LinkedIn Page](https://www.linkedin.com/company/violence-ends-with-us/?viewAsMember=true) or [Instagram Account](https://www.instagram.com/violenceendswithus?utm_source=ig_web_button_share_sheet&stkn=ZDNlZDc0MzIxNw==), or email us at [violenceendswithus@gmail.com](mailto:violenceendswithus@gmail.com)\n\n' +
        'You may also reach out to the summit organisers directly:\n\n' +
        '**Bryanna Mariñas**\nFounder, Violence Ends With Us | Global Youth-Led Movement on Ending Violence Against Children\n[bryanna.marinas@gmail.com](mailto:bryanna.marinas@gmail.com) | +65 8269 1938 (WhatsApp)\n\n' +
        '**Chrisindah Janecilsky Khosuma**\nProgram and Impact Director, Violence Ends With Us\n[chrisindah.khosuma@gmail.com](mailto:chrisindah.khosuma@gmail.com) | +62 838-3319-2311 (WhatsApp)',
      blocks: [],
    },
  ],
};

/** The stored schema if it is usable, otherwise the default form. */
export function resolveForm(stored: unknown): FormSchema {
  const s = stored as FormSchema | null;
  if (s && s.version === 1 && Array.isArray(s.sections) && validateSchema(s).length === 0) return s;
  return DEFAULT_FORM;
}
