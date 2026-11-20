import type { Messages } from './index';

/**
 * Czech texts of the review screen. Typed against `en.ts`: a missing key fails `npm run check`.
 * Glossary: Komentář, Komentování (comment mode), Prohlížení (browse mode), Obnovit stav, Otevřené /
 * Schválené / Zamítnuté (chips), otevřený / schválený / zamítnutý (one comment), Odpovědět, Nahraný web,
 * Zobrazení (viewport), Počítač (desktop), Moje, Vše. Czech quotes „…“.
 */
export const cs: Messages = {
  // ---- page ----
  'page.title': 'Komentáře · {name}',
  'page.projectNotFound': 'Projekt nebyl nalezen',
  'smallScreen.title': 'Reviewer potřebuje větší obrazovku',
  'smallScreen.body':
    'Při komentování procházíte web, komentáře máte vedle něj a ukazujete na prvek, o kterém píšete. To se na telefon nevejde – otevřete tuto stránku na počítači nebo notebooku.',

  // ---- toolbar ----
  'toolbar.allProjects': 'Všechny projekty',
  'toolbar.back': 'Zpět',
  'toolbar.forward': 'Vpřed',
  'toolbar.reload': 'Načíst znovu',
  'toolbar.pagePath': 'Cesta ke stránce',
  'toolbar.openOnSite': 'Otevřít tuto stránku na skutečném webu',
  'toolbar.uploadedSite': 'Nahraný web',
  'toolbar.viewport': 'Zobrazení',
  'toolbar.desktop': 'Počítač',
  'toolbar.desktopTitle': 'Počítač – stránka vyplní okno',
  'toolbar.phone': 'iPhone 15',
  'toolbar.phoneTitle': 'iPhone 15 – zobrazení 393 × 852 px',
  'toolbar.mode': 'Režim klikání',
  'toolbar.browse': 'Prohlížení',
  'toolbar.browseTitle': 'Prohlížení (C) – klikání funguje jako na skutečném webu',
  'toolbar.comment': 'Komentování',
  'toolbar.commentTitle': 'Komentování (C) – kliknutím na prvek napíšete komentář',
  'toolbar.help': 'Jak to funguje',

  // ---- mode chip under the page ----
  'hint.browseMode': 'Prohlížení',
  'hint.commentMode': 'Komentování',
  'hint.altHeld': 'Držíte ⌥ – toto kliknutí jde do stránky',
  'hint.comment': 'Klikněte na prvek a napište komentář · s ⌥ ovládáte stránku',
  'hint.browse': 'Klikání funguje jako na skutečném webu · klávesou C začnete komentovat',

  // ---- intro card ----
  'intro.title': 'Dva způsoby klikání',
  'intro.lead': 'Web níže je živý. Začínáte v režimu Prohlížení; režim určuje, co kliknutí udělá.',
  'intro.browseName': 'Prohlížení',
  'intro.browseText': '– web se chová jako obvykle, takže se dostanete na stránku, kterou chcete komentovat. Komentáře zůstávají vidět.',
  'intro.commentName': 'Komentování',
  'intro.commentText': '– prvek pod myší se zvýrazní, kliknutím na něj otevřete nový komentář. Podržením',
  'intro.commentTextAfter': 'jednou kliknete přímo do stránky (lišta cookies, nabídky).',
  'intro.switch': 'Přepnete přepínačem nahoře nebo klávesou',
  'intro.switchAfter': '.',
  'intro.mute': 'Rozumím, příště nezobrazovat',
  'intro.start': 'Začít',

  // ---- sidebar ----
  'sidebar.title': 'Komentáře',
  'sidebar.viewportHint': 'Komentář patří k zobrazení, ve kterém vznikl – na telefonu vypadá stránka jinak',
  'sidebar.filter': 'Filtr komentářů',
  'sidebar.all': 'Vše {count}',
  'sidebar.mine': 'Moje {count}',
  'sidebar.statusFilter': 'Filtr podle stavu',
  'sidebar.showStatus': 'Zobrazit {status} komentáře',
  'sidebar.hideStatus': 'Skrýt {status} komentáře',
  'sidebar.otherDesktop': {
    one: '{count} komentář v zobrazení Počítač – přepnout',
    few: '{count} komentáře v zobrazení Počítač – přepnout',
    many: '{count} komentáře v zobrazení Počítač – přepnout',
    other: '{count} komentářů v zobrazení Počítač – přepnout',
  },
  'sidebar.otherPhone': {
    one: '{count} komentář v zobrazení iPhone 15 – přepnout',
    few: '{count} komentáře v zobrazení iPhone 15 – přepnout',
    many: '{count} komentáře v zobrazení iPhone 15 – přepnout',
    other: '{count} komentářů v zobrazení iPhone 15 – přepnout',
  },
  'sidebar.frameError': 'Stránku se nepodařilo načíst přes proxy. Zkontrolujte adresu webu v nastavení projektu.',
  'sidebar.loading': 'Načítám…',
  'sidebar.emptyMine': 'Tady zatím nemáte žádný komentář',
  'sidebar.empty': 'Tady zatím nejsou žádné komentáře',
  'sidebar.hiddenByStatus': {
    one: 'Filtr stavu skrývá {count} komentář.',
    few: 'Filtr stavu skrývá {count} komentáře.',
    many: 'Filtr stavu skrývá {count} komentáře.',
    other: 'Filtr stavu skrývá {count} komentářů.',
  },
  'sidebar.emptyComment': 'Klikněte na cokoli na stránce a napište první komentář.',
  'sidebar.emptyBrowse': 'Přepněte na Komentování (C) a klikněte na prvek.',
  'sidebar.manage': 'Správa projektu a export',

  // ---- status ----
  'filter.open': 'Otevřené',
  'filter.approved': 'Schválené',
  'filter.rejected': 'Zamítnuté',
  'status.open': 'Otevřený',
  'status.approved': 'Schválený',
  'status.rejected': 'Zamítnutý',

  // ---- composer, cards, replies ----
  'draft.title': 'Nový komentář',
  'draft.placeholder': 'Co se tu má změnit?',
  'draft.keys': '⌘↵ uložit · esc zrušit',
  'action.cancel': 'Zrušit',
  'action.save': 'Uložit',
  'action.saving': 'Ukládám…',
  'action.edit': 'Upravit',
  'action.delete': 'Smazat',
  'action.reply': 'Odpovědět',
  'action.sending': 'Odesílám…',
  'action.approve': 'Schválit',
  'action.reject': 'Zamítnout',
  'action.reopen': 'Znovu otevřít',
  'action.restore': 'Obnovit stav',
  'action.restoreTitle': 'Vrátit stránku do stavu, ve kterém byl komentář napsán',
  'card.you': 'Vy',
  'card.decidedBy': '{status} · {who}',
  'card.decidedByYou': 'vy',
  'card.decidedBySomeone': 'neznámo kým',
  'card.notFound': 'Prvek nenalezen',
  'card.notFoundTitle': 'Prvek, ke kterému komentář patří, už na stránce není (změnil se web?). Komentář zůstává.',
  'card.byText': 'Nalezeno podle textu',
  'card.byTextTitle': 'Nalezeno podle textu – struktura stránky se od napsání komentáře změnila.',
  'reply.placeholder': 'Odpověď…',
  'reply.keys': '⌘↵ odeslat · esc zrušit',
  'confirm.deleteComment': 'Smazat tento komentář?',
  'confirm.deleteReply': 'Smazat tuto odpověď?',
  'time.justNow': 'právě teď',
  quote: '„{text}“',

  // ---- overlay inside the frame ----
  'overlay.plus': 'Přidat komentář k tomuto prvku',
  'overlay.marker': 'Komentář č. {number}',
  'overlay.markerDecided': 'Komentář č. {number} – {status}',

  // ---- errors ----
  'error.restore': 'Tato stránka neumí uložený stav obnovit.',
  'error.network': 'Reviewer je nedostupný – zkontrolujte připojení a zkuste to znovu.',
  'error.http': 'Požadavek se nepovedl (HTTP {status}).',
  'error.unexpected': 'Něco se nepovedlo: {detail}',
  'api.commentEmpty': 'Komentář nesmí být prázdný',
  'api.replyEmpty': 'Odpověď nesmí být prázdná',
  'api.editOwn': 'Upravit můžete jen své komentáře',
  'api.deleteOwn': 'Smazat můžete jen své komentáře',
  'api.decidedEdit': 'Rozhodnutý komentář už nejde upravit',
  'api.decidedDelete': 'Rozhodnutý komentář už nejde smazat',
  'api.replyOwn': 'Měnit můžete jen své odpovědi',
  'api.managerOnly': 'Tohle může jen správce projektu',
  'api.commentNotFound': 'Komentář nebyl nalezen',
  'api.replyNotFound': 'Odpověď nebyla nalezena',
  'api.projectNotFound': 'Projekt nebyl nalezen',
  'api.internal': 'Chyba serveru',

  // ---- pages served inside the review frame ----
  'frame.emptyTitle': 'Reviewer – nic nenahráno',
  'frame.emptyHeading': 'Zatím nebylo nic nahráno',
  'frame.emptyBody': 'Správce může sestavený web nahrát na stránce správy projektu.',
  'frame.errorTitle': 'Reviewer – chyba proxy',
  'frame.errorHeading': 'Stránku se nepodařilo načíst',
  'frame.noResponse': 'Cílový web neodpověděl: {detail}',
  'frame.readFailed': 'Odpověď webu nešlo přečíst: {detail}',
  'frame.target': 'Cíl:',
};
