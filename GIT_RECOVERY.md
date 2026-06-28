# GIT_RECOVERY.md — État git réel & procédure de bascule locale (2026-06-28)

## 1. État git PROUVÉ (commandes réelles)

```
git rev-parse HEAD            → c55e6c5  (= PAQUET 1, "docs(governance)…")
git status --porcelain        → 36 fichiers " M" + 70 "??" (dont 66 nouveaux .ts backend + 4 migrations)
git cat-file -t 96db475       → commit            (objet existe)
git branch --contains 96db475 → (vide)            (AUCUNE branche ne le contient)
git for-each-ref --contains 96db475 → (vide)      (AUCUNE ref ne le référence)
git merge-base --is-ancestor 96db475 HEAD → rc=1  (PAS ancêtre de HEAD)
git reflog                    → HEAD@{0} = c55e6c5 (HEAD n'a jamais avancé)
```

**Conclusion sans ambiguïté :**
- La branche `fix/ticket-number-sequence-cursor` est restée sur **`c55e6c5` (PAQUET 1)**.
- Tout le travail des **paquets 2 → 35 est NON COMMITÉ**, présent dans le **working tree** (36 modifs + 70 nouveaux).
- Les « backup commits » créés en session (`a6b7cc8 … 96db475`) sont des **objets commit PENDANTS** (dangling) : durables dans `.git/objects`, mais **référencés par aucune branche/ref** → récupérables seulement par hash et **sujets au `git gc`**.
- ⇒ **La source de vérité est le working tree**, pas les commits pendants ni les patches.

## 2. Cause du blocage (qualifiée)

Le dépôt est monté en **FUSE** (`type fuse … default_permissions`). Les fichiers de verrou git sont **résiduels et non supprimables** depuis le sandbox :
```
rm .git/index.lock                → rm: Operation not permitted   (EPERM FUSE)
git commit / git update-ref       → cannot create '.git/HEAD.lock': File exists / Operation not permitted
```
Conséquence : impossible de **créer ou déplacer une ref** depuis le sandbox (commit classique, `update-ref`). L'écriture d'objets fonctionne (d'où les commits pendants), mais sans ref ils restent inatteignables par branche.

## 3. Procédure de SORTIE (sur ta machine, app desktop fermée)

L'app desktop tient probablement les verrous. **Ferme-la / termine ses process git**, puis :

```bash
cd ~/CAISSE

# 1. Lever les verrous résiduels (sûr : ce sont des locks, pas des données)
rm -f .git/index.lock .git/HEAD.lock .git/refs/heads/*.lock 2>/dev/null

# 2. Committer le working tree (= SOURCE DE VÉRITÉ, contient tout le travail 2→35)
git add -A
git commit -m "POS audit session — paquets 2→35 (helpers testés + migrations 1721-1724)"

# 3. Vérifier
git log --oneline -3
git status   # doit être propre
```

Option B (réutiliser le dernier commit pendant s'il n'a pas été gc) :
```bash
git cat-file -t 96db475 && git update-ref refs/heads/fix/ticket-number-sequence-cursor 96db475
# ⚠️ 96db475 a été créé avec `git add -A` : il embarque aussi des fichiers incidents
# (.remember/, RAPPORT_20H.md, .claude/launch.json). Préférer l'Option A (add sélectif possible).
```

Les patches `_BACKUP_PAQUET_2-*.patch` (à la racine) sont des `git diff c55e6c5 <snapshot>` — utiles comme archive, **non nécessaires** si le working tree est intact.

## 4. Voir `CONSOLIDATION_LOCALE.md` pour : l'inventaire par paquet, la séquence de validation locale (tests/migrations/build) et le statut des migrations.
