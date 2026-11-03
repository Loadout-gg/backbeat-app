# Flusso Git e staging di Backbeat

Queste istruzioni valgono per Claude e per gli altri agenti che lavorano con Simone. Simone descrive il risultato di prodotto; l'agente controlla branch, permessi, test e destinazione. Non delegare a Simone decisioni tecniche non spiegate.

## Flusso approvato

Un solo repository: `Loadout-gg/backbeat-app`. Nessun fork o repository aggiuntivo. Il branch predefinito del repository è `staging`; `main` rimane il branch di rilascio live. Il default GitHub non modifica il Branch Tracking dei progetti Vercel.

| Branch | Scopo | Progetto Vercel | URL |
| --- | --- | --- | --- |
| `staging` | Collaudo condiviso, non produzione | `backbeat-staging` | https://backbeat-staging.vercel.app |
| `main` | Versione live approvata | `backbeat-app` | https://app.backbeat.show |

Percorso normale: `feat/*` o `fix/*` -> PR verso `staging` -> verifica sullo staging -> PR di rilascio `staging` -> `main`, solo dopo autorizzazione esplicita di Alberto. Il nome Production in Vercel è relativo al singolo progetto: non identifica da solo la live.

Il collegamento Vercel e un build verde non provano che lo staging sia utilizzabile. Prima di dichiarare un deploy riuscito, verificare progetto, commit, branch, URL e backend. Non dichiarare funzionante un'automazione ancora non verificata.

## Prima sessione di Claude e checkout già esistenti

Un nuovo clone parte da `staging`. I checkout esistenti e le vecchie PR non cambiano branch da soli.

Prima della prima attività con queste regole, verificare `origin`, branch e `git status --short`. Con modifiche non salvate, fermarsi senza stash/reset. In un checkout pulito, eseguire `git fetch origin` e leggere la guida aggiornata con `git show origin/staging:docs/agents/git-workflow.md`.

Per una nuova attività, creare il branch di lavoro da `origin/staging`: conterrà `AGENTS.md`, `CLAUDE.md` e la guida aggiornata. Avviare una nuova sessione Claude Code dalla radice di quel checkout e usare `/memory` per verificare i file caricati; chiedere a Claude di riassumere base PR, ambiente e autorità di merge prima di scrivere codice.

Per una vecchia PR, non cambiare branch né importare tutta `staging` automaticamente: leggere anche `git show origin/staging:AGENTS.md`, fornire esplicitamente a Claude le istruzioni correnti e coordinare con Alberto l'aggiornamento della catena. Se si usa Claude senza caricamento dei file di progetto, allegare esplicitamente la guida corrente e `AGENTS.md`; non presumere che un link sia stato letto.

## Prima di modificare qualsiasi file

1. Leggere `AGENTS.md`, questa guida e i contratti applicabili in `docs/agents/`.
2. Ispezionare il checkout, senza modificare o pubblicare nulla:

```sh
git remote get-url origin
git status --short
git branch --show-current
git rev-parse HEAD
```

3. Verificare che `origin` identifichi esattamente `Loadout-gg/backbeat-app`. Sono ammesse le normali forme HTTPS e SSH dello stesso repository. Se il repository è diverso, fermarsi.
4. Se ci sono modifiche non proprie, fermarsi e spiegare a Simone quali file sono coinvolti. Non cancellare, sovrascrivere, committare o mettere in stash il lavoro altrui.
5. Per una nuova attività indipendente e un checkout pulito: eseguire `git fetch origin`, controllare che `origin/staging` esista e creare un nuovo branch `feat/<descrizione>` o `fix/<descrizione>` da `origin/staging`. Non lavorare direttamente su `main` o `staging`.
6. Se si sta continuando una PR esistente, leggere prima head, base e dipendenze con `gh pr view <numero> --repo Loadout-gg/backbeat-app`. Non cambiare branch di base, rebase, cherry-pick o catene di PR automaticamente. Le PR dipendenti già aperte vanno coordinate con Alberto.
7. Riassumere a Simone, in italiano: risultato richiesto, branch di lavoro, base della PR e cosa NON verrà modificato.

## Implementazione e controlli

Restare entro l'attività assegnata. Non introdurre librerie, upgrade, redesign o cambi architetturali per rendere più comodo il task. Il contratto architetturale e la sua escalation restano quelli di `AGENTS.md`.

Leggere i pin correnti in `.node-version`, `package.json`, lockfile e CI. Non usare versioni ricordate da una vecchia chat. Per installare dipendenze già previste, quando autorizzato: `pnpm install --frozen-lockfile --ignore-scripts`. Non rigenerare il lockfile o abilitare script per aggirare un errore.

Eseguire i test focalizzati della modifica e i controlli applicabili:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:runtime
git diff --check
```

La CI `Quality` esegue anche build, smoke test `next-start`, qualificazione del container e audit delle dipendenze, secondo `.github/workflows/ci.yml`. I controlli locali sopra non sostituiscono la CI completa né autorizzano un merge con `Quality` fallito o mancante.

Un controllo non eseguito va indicato come `NOT_RUN`, con motivo. Non disabilitare controlli o riscrivere test per ottenere verde. Per build e test con backend seguire `docs/agents/development.md`; mai usare la produzione come ambiente di test.

## Commit, push e PR

- Un'autorizzazione a sviluppare non è automaticamente un'autorizzazione a pubblicare. Se Simone ha chiesto esplicitamente di preparare/pubblicare una PR, quella richiesta copre il push del solo branch di lavoro e la PR verso `staging`; altrimenti chiedere prima di pubblicare.
- Controllare `git diff` e aggiungere solo i file della modifica. Non usare `git add .` alla cieca.
- Non committare `.env*` con segreti, token, password, chiavi amministrative, dump, dati reali, `.vercel/` o credenziali di altri ambienti. Conservare gli eventuali template di esempio privi di segreti già previsti dal repository.
- Usare un push esplicito verso il proprio branch e creare la PR con base esplicita `staging`, mai affidarsi al default `main`.
- Per creare una PR usare `gh pr create --repo Loadout-gg/backbeat-app --base staging --head <branch-di-lavoro> --title <titolo> --body-file <file-descrizione>`; poi rileggere URL, head e base con `gh pr view`.
- Descrivere risultato visibile, file modificati, test reali, limiti e passi di collaudo per una persona non tecnica.
- Attendere il check GitHub `Quality` sul commit corrente. Un check verde su un commit precedente non vale.
- Non fare merge autonomamente, non attivare auto-merge e non approvare il proprio lavoro. **Simone può autorizzare il merge di una PR verso `staging`**, senza attendere Alberto, dopo che l'agente ha mostrato link della PR, risultato atteso e `Quality` verde sul commit corrente. L'agente deve prima dichiarare: “Questo merge aggiorna solo lo staging, non la live. Confermi il merge della PR indicata?”. Un “sì” in risposta vale per quella PR, non per altre attività. Dopo il consenso verificare nuovamente head/base/check e fare un merge vincolato alla head verificata; non usare `--admin` o bypass. L'autorizzazione a creare una PR non include il merge.

## Staging e rilascio

Dopo un merge autorizzato su `staging`, verificare il deploy del progetto `backbeat-staging` sullo stesso commit. Non usare le Preview del progetto live come sostituto. Lo staging è condiviso: coordinare i test prima di sostituire una candidata. Il progetto ha un filtro di build per il branch `staging`: non assumere che un deploy manuale da un altro branch sia una via alternativa disponibile e non rimuovere il filtro per sbloccarlo.

### Verificare il deploy senza accesso amministrativo Vercel

Ricavare dalla PR il commit di merge su `staging`, non usare la precedente head del branch di lavoro. Con l'accesso GitHub già disponibile, leggere gli stati di quel commit e i deployment:

```sh
# STAGING_SHA must be the exact merge commit read from the merged PR.
: "${STAGING_SHA:?Impostare il commit di merge verificato della PR}"
gh api "repos/Loadout-gg/backbeat-app/commits/$STAGING_SHA/status"
gh api "repos/Loadout-gg/backbeat-app/commits/$STAGING_SHA/check-runs"
gh api "repos/Loadout-gg/backbeat-app/deployments?sha=$STAGING_SHA"
```

Se è presente un record di deployment, leggere `repos/Loadout-gg/backbeat-app/deployments/<deployment-id>/statuses`. Verificare SHA, progetto `backbeat-staging` e URL staging dal record/link del provider: un generico check Vercel verde o l'etichetta Production non bastano, perché il repository è condiviso da due progetti. La versione corrente su `origin/staging` può essere avanzata nel frattempo: non attribuirle i test di una candidata precedente.

Se GitHub non espone prove sufficienti, riportare `DEPLOY_NOT_VERIFIED` e chiedere ad Alberto la verifica del deployment, senza richiedere token o accesso amministrativo. Visitare il sito protetto richiede un accesso separato; la sua assenza non impedisce di preparare la PR. Non dichiarare verificati login o percorsi applicativi da un semplice stato di deployment.

Un push o merge su `main` può aggiornare immediatamente la live. Non creare una PR verso `main`, fare merge o eseguire un deploy/promozione live senza un'autorizzazione esplicita di Alberto riferita alla candidata da rilasciare. Una richiesta generica di Simone come “finisci”, “pubblica” o “metti online” non autorizza la produzione: chiarire che l'azione proposta riguarda lo staging.

Per un rilascio autorizzato, la base è `main` e la head è `staging`; verificare il diff completo, i check correnti, le migrazioni necessarie e la review di prodotto di Alberto. Solo l'account `DerekLoadout` può aggiornare `main`; mantenere PR e `Quality` obbligatori, senza richiedere una seconda approvazione GitHub che bloccherebbe le PR dello stesso proprietario. Questa configurazione non sostituisce l'autorizzazione di Alberto al rilascio specifico.

Tra i due branch permanenti usare un **merge commit**, non squash o rebase, e non cancellare `staging`.

### Riallineamento standard dopo ogni rilascio

Il merge `staging` -> `main` crea un commit su `main` che `staging` deve acquisire. Il riallineamento è parte del rilascio autorizzato, non una nuova scelta architetturale:

1. Verificare PR di rilascio merged, SHA di `main` e stato effettivo della live; non avviare un nuovo rilascio se quello corrente non è qualificato.
2. Controllare divergenza tra i branch. Se `main` è già antenato di `staging`, non creare una PR inutile.
3. Altrimenti aprire una PR con **head `main`, base `staging`**, dedicata al riallineamento. Non aggiungere feature e non fare push diretto ai branch protetti.
4. Attendere `Quality` verde sulla PR e verificare che non ci siano conflitti o modifiche inattese. Completare il merge commit come parte del rilascio già autorizzato. In caso di conflitti o lavoro concorrente ambiguo, fermarsi e chiedere ad Alberto; niente risoluzioni alla cieca.
5. Dopo `git fetch origin`, verificare `git merge-base --is-ancestor origin/main origin/staging` (exit 0). Il riallineamento può avviare un nuovo deploy staging; registrare il nuovo SHA. Non fare un secondo merge verso `main` solo per inseguire il commit di riallineamento.

La regola serve anche dopo un hotfix live autorizzato. Nuove attività indipendenti partono dallo `staging` riallineato.

## Confini che non si aggirano

- Niente push diretto su `main`/`staging`, force push, `reset --hard`, `git clean`, cancellazioni di branch o riscrittura della storia per sbloccare il lavoro.
- Non cambiare branch protection, workflow CI, istruzioni degli agenti, collegamenti Git/Vercel, domini, variabili d'ambiente, piano o permessi come parte di una feature ordinaria.
- Simone collabora su GitHub; non serve un invito amministrativo Vercel. Se Hobby blocca un deploy, riportare l'errore: non cambiare autore/email dei commit, condividere account, aggiungere token o aggirare il blocco.
- Usare solo account e dati sintetici dello staging. Credenziali e database live non sono un fallback.
- Le modifiche al database devono essere versionate e descritte nella PR. Non applicare SQL o migrazioni automaticamente: l'esecuzione sul backend richiede un'autorizzazione specifica per il target. Il deploy del codice non applica le migrazioni.
- Non modificare Auth, conferma email, RLS, ruoli o membership per far passare un test. Account applicativo, accesso al sito protetto e membership amministrativa sono permessi distinti.

## Consegna a Simone

Fornire sempre, in italiano:

1. Cosa cambia per l'utente, in poche righe.
2. Link PR, branch di base e commit verificato.
3. Test PASS/FAIL/NOT_RUN, senza risultati inventati.
4. URL staging e commit effettivamente deployato, oppure motivo per cui il deploy non è verificato.
5. Passi semplici per provare il risultato e cosa aspettarsi.
6. Cosa resta da approvare. Specificare sempre se la live è rimasta invariata.

Le istruzioni guidano l'agente ma non sostituiscono i controlli GitHub. Non dichiarare che Claude le ha caricate o rispettate senza una verifica nella sessione effettivamente usata da Simone.
