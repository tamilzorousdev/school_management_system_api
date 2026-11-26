import type { TemplateDefinition } from './notification-templates.catalog';

export const GALLERY_TEMPLATES = {
  GALLERY_ALBUM_SHARED: 'GALLERY_ALBUM_SHARED',
  GALLERY_DELETION_SCHEDULED: 'GALLERY_DELETION_SCHEDULED',
  GALLERY_CLEANUP_DONE: 'GALLERY_CLEANUP_DONE',
  GALLERY_CLEANUP_FAILED: 'GALLERY_CLEANUP_FAILED',
  GALLERY_STORAGE_WARNING: 'GALLERY_STORAGE_WARNING',
  GALLERY_STORAGE_FULL: 'GALLERY_STORAGE_FULL',
} as const;

const admin = { category: 'system' as const, push: true, sms: 'never' as const, critical: false };

export const GALLERY_TEMPLATE_CATALOG: TemplateDefinition[] = [
  {
    category: 'announcement',
    push: true,
    sms: 'never',
    critical: false,
    code: GALLERY_TEMPLATES.GALLERY_ALBUM_SHARED,
    text: {
      en: {
        title: 'New in the gallery: {{title}}',
        body: '{{count}} photos and videos from {{place}} are ready to view.',
        sms_body: null,
      },
      ta: {
        title: 'கேலரியில் புதியவை: {{title}}',
        body: '{{place}} இலிருந்து {{count}} படங்கள் மற்றும் காணொளிகளைப் பார்க்கலாம்.',
        sms_body: null,
      },
    },
  },
  {
    ...admin,
    code: GALLERY_TEMPLATES.GALLERY_DELETION_SCHEDULED,
    text: {
      en: {
        title: 'Gallery media scheduled for deletion',
        body: '{{count}} photos and videos have reached the end of their retention and move to Trash from {{date}}. Add a retention hold to keep any of them.',
        sms_body: null,
      },
      ta: {
        title: 'கேலரி கோப்புகள் நீக்கத் திட்டமிடப்பட்டுள்ளன',
        body: '{{count}} படங்கள் மற்றும் காணொளிகளின் சேமிப்புக் காலம் முடிந்தது. {{date}} முதல் குப்பைக்கு நகர்த்தப்படும். வைத்திருக்க வேண்டியவற்றுக்குத் தடுப்பு சேர்க்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    ...admin,
    code: GALLERY_TEMPLATES.GALLERY_CLEANUP_DONE,
    text: {
      en: {
        title: 'Gallery cleanup finished',
        body: '{{trashed}} moved to Trash, {{purged}} deleted for good, {{freed}} freed. {{held}} kept by retention holds. {{failed}} could not be deleted.',
        sms_body: null,
      },
      ta: {
        title: 'கேலரி சுத்தம் முடிந்தது',
        body: '{{trashed}} குப்பைக்கு நகர்த்தப்பட்டன, {{purged}} நிரந்தரமாக நீக்கப்பட்டன, {{freed}} இடம் விடுவிக்கப்பட்டது. {{held}} தடுப்பால் வைக்கப்பட்டன. {{failed}} நீக்க முடியவில்லை.',
        sms_body: null,
      },
    },
  },
  {
    ...admin,
    code: GALLERY_TEMPLATES.GALLERY_CLEANUP_FAILED,
    text: {
      en: {
        title: 'Gallery cleanup failed',
        body: 'The gallery cleanup stopped: {{error}}. Open Cleanup Monitoring to see the details and retry.',
        sms_body: null,
      },
      ta: {
        title: 'கேலரி சுத்தம் தோல்வியடைந்தது',
        body: 'கேலரி சுத்தம் நின்றது: {{error}}. விவரங்களுக்கும் மீண்டும் முயலவும் சுத்தக் கண்காணிப்பைத் திறக்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    ...admin,
    code: GALLERY_TEMPLATES.GALLERY_STORAGE_WARNING,
    text: {
      en: {
        title: 'Gallery storage is {{percent}}% full',
        body: '{{used}} of {{quota}} is used. Free space from Trash or raise the storage quota.',
        sms_body: null,
      },
      ta: {
        title: 'கேலரி சேமிப்பு {{percent}}% நிரம்பியுள்ளது',
        body: '{{quota}} இல் {{used}} பயன்படுத்தப்பட்டுள்ளது. குப்பையிலிருந்து இடத்தை விடுவிக்கவும் அல்லது அளவை உயர்த்தவும்.',
        sms_body: null,
      },
    },
  },
  {
    ...admin,
    code: GALLERY_TEMPLATES.GALLERY_STORAGE_FULL,
    text: {
      en: {
        title: 'Gallery storage is full',
        body: '{{used}} of {{quota}} is used. New uploads are blocked until space is freed or the quota is raised.',
        sms_body: null,
      },
      ta: {
        title: 'கேலரி சேமிப்பு நிரம்பிவிட்டது',
        body: '{{quota}} இல் {{used}} பயன்படுத்தப்பட்டுள்ளது. இடம் விடுவிக்கப்படும் வரை அல்லது அளவு உயர்த்தப்படும் வரை புதிய பதிவேற்றங்கள் தடுக்கப்படும்.',
        sms_body: null,
      },
    },
  },
];
