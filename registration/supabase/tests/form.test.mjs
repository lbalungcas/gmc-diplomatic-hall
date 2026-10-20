// Form engine checks (validation, branching, the built-in form). Run: npm run test:form
// Node ≥ 22.18 strips the TypeScript types from form.ts on import.
import {
  DEFAULT_FORM, extractCore, questions, sectionPath, validateSchema, validateSubmission,
} from '../functions/_shared/form.ts';

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
};

const form = DEFAULT_FORM;
ok(validateSchema(form).length === 0, 'built-in form is valid', validateSchema(form).join('; '));
ok(form.sections.length === 9, 'built-in form has 9 sections like the Google Form');
ok(questions(form).length === 25, 'built-in form has 25 questions', String(questions(form).length));

const complete = {
  category: 'I am a child / youth',
  organization: 'Youth Org',
  attendance: ['In person, at the Marriott Hotel Manila'],
  full_name: 'Maria Santos',
  preferred_name: 'Maria',
  age: '16',
  nationality: 'Filipino',
  country: 'Philippines',
  sex: 'Female',
  gender: 'Other: Genderfluid',
  email: 'Maria@Example.org',
  phone: '+63 917 555 1234',
  thematic_focus: ['Corporal Punishment'],
  thematic_reason: 'Because…',
  spaces: [questions(form).find((q) => q.id === 'spaces').options[1].label],
  deal_corner_interest: 'No, I am not interested',
  guest_confirmation: ['I confirm my participation in the in-person and/or online booth of Youth Innovations Marketplace on 17 November 2026.'],
  safeguarding: ['I agree to uphold safeguarding standards and to participate in a respectful, inclusive, and youth-friendly manner throughout the event.'],
  accuracy: ['I confirm that the information provided in this registration form is accurate to the best of my knowledge.'],
  communications: ['I agree to be tagged in the calendar invites and contacted by the Violence Ends With Us regarding the confirmation and agenda of Youth Innovations Marketplace.'],
  deal_corner_topics: ['Corporal Punishment'], // answered, then skipped by choosing "No"
};

const ids = (a) => sectionPath(form, a).map((s) => s.id).join(',');
ok(ids(complete) === 's1,s2,s3,s4,s5,s6,s8,s9', 'Deal Corner "No" skips section 7', ids(complete));
ok(ids({ ...complete, deal_corner_interest: 'Yes, I am interested' }) === 's1,s2,s3,s4,s5,s6,s7,s8,s9', 'Deal Corner "Yes" goes to section 7');
ok(ids({ ...complete, deal_corner_interest: undefined }).includes('s7'), 'unanswered Deal Corner continues to section 7 (as in Google Forms)');

let r = validateSubmission(form, complete);
ok(r.ok, 'complete submission is valid', JSON.stringify(r.errors));
ok(r.core.email === 'maria@example.org' && r.core.age === 16 && r.core.preferred_name === 'Maria' && r.core.category === 'I am a child / youth',
  'core fields extracted (email lower-cased)', JSON.stringify(r.core));
ok(!('deal_corner_topics' in r.answers), 'answers from skipped sections are dropped');

r = validateSubmission(form, { ...complete, sex: undefined, thematic_reason: '  ' });
ok(!r.ok && r.errors.sex && r.errors.thematic_reason, 'required questions enforced');
r = validateSubmission(form, { ...complete, gender: 'Other: ' });
ok(r.errors.gender === 'Please fill in your "Other" answer.', 'blank "Other" rejected');
r = validateSubmission(form, { ...complete, sex: 'Robot' });
ok(!!r.errors.sex, 'unknown radio option rejected (no "Other" allowed)');
r = validateSubmission(form, { ...complete, attendance: ['Hacked option'] });
ok(!!r.errors.attendance, 'unknown checkbox option rejected');
r = validateSubmission(form, { ...complete, email: 'nope' });
ok(!!r.errors.email, 'invalid email rejected');
r = validateSubmission(form, { ...complete, phone: 'call me' });
ok(!!r.errors.phone, 'invalid phone rejected');
r = validateSubmission(form, { ...complete, age: '16.5' });
ok(!!r.errors.age, 'non-integer age rejected');
r = validateSubmission(form, { ...complete, guest_confirmation: [] });
ok(!!r.errors.guest_confirmation, 'final confirmations are required');
r = validateSubmission(form, { ...complete, deal_corner_interest: 'Yes, I am interested' });
ok(r.ok, 'Deal Corner section questions are optional');
r = validateSubmission(form, 'garbage');
ok(!r.ok, 'non-object submission rejected');

const broken = structuredClone(form);
broken.sections[2].blocks = broken.sections[2].blocks.filter((b) => b.id !== 'email');
ok(validateSchema(broken).some((p) => p.includes('Email')), 'editor refuses a form without an email question');
const badJump = structuredClone(form);
badJump.sections[5].blocks[1].options[0].goTo = 'gone';
ok(validateSchema(badJump).some((p) => p.includes('no longer exists')), 'editor refuses a jump to a deleted section');
const dupOpt = structuredClone(form);
dupOpt.sections[2].blocks.find((b) => b.id === 'sex').options.push({ label: 'Male' });
ok(validateSchema(dupOpt).some((p) => p.includes('duplicate')), 'editor refuses duplicate options');

ok(extractCore(form, { age: '200' }).age === null, 'out-of-range age not stored');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
