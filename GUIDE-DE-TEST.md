# Guide de test complet — OpenCoperLock

Fiche pas-à-pas, du serveur vierge jusqu'à la vérification de chaque fonctionnalité.
Coche au fur et à mesure et remplis le champ **Retour** (✅ / ❌ + commentaire) sous chaque
point. Renvoie-moi ce fichier annoté.

**Légende** — Action à faire → résultat attendu. `Retour :` = ta note.

Pré-requis : une VM Linux Debian/Ubuntu avec accès SSH et `sudo`. Optionnel mais
recommandé : un (sous-)domaine pointant vers l'IP de la VM pour le HTTPS automatique.

> Astuce accès : si tu n'as pas de domaine, tu peux tester depuis la VM avec `curl`, ou
> ouvrir un tunnel SSH depuis ton PC : `ssh -L 3000:localhost:3000 -L 4000:localhost:4000 user@vm`
> puis ouvrir `http://localhost:3000`.

---

## 1. Installation

### 1.1 Cloner le projet
```bash
git clone https://github.com/softpython2884/opencoperlock.git
cd opencoperlock
```
- [ ] Le dépôt est cloné.
      Retour :

### 1.2 Lancer l'assistant d'installation
```bash
bash scripts/setup-wizard.sh
```
Réponds aux questions :
- **Topologie** : `1` (deux sous-domaines) ou `2` (un domaine + `/api`) si tu as un domaine ;
  `3` (local) sinon.
- **Base de données** : choisis **`1` (Project-local DB)** → PostgreSQL dans le projet sur un
  port aléatoire, géré par PM2.
- **Admin** : email + mot de passe (≥ 12 caractères).
- **Stockage / quotas** : chemin (défaut `/var/lib/opencoperlock`), quota par défaut, cap global.
- **ClamAV** : `O` si tu veux l'antivirus (sinon les fichiers seront « unscanned »).
- **TLS** : `O` si tu as un domaine pointé → certificat Let's Encrypt automatique.

- [ ] L'assistant se termine par « OpenCoperLock is installed and running ».
      Retour :

### 1.3 Persister PM2 au reboot
```bash
pm2 save
pm2 startup            # exécute la commande que PM2 affiche (avec sudo)
```
- [ ] `pm2 startup` configuré (le service redémarrera au boot).
      Retour :

---

## 2. Vérifications post-installation

### 2.1 Les processus tournent
```bash
pm2 status
```
- [ ] Je vois **3** process `online` : `opencoperlock-postgres`, `opencoperlock-api`,
      `opencoperlock-web`.
      Retour :

### 2.2 La base locale est bien dans le projet, sur un port aléatoire
```bash
cat .postgres/port
grep DATABASE_URL .env
```
- [ ] `.postgres/port` contient un port aléatoire, et ce **même port** apparaît dans le
      `DATABASE_URL` du `.env`. Aucun port fixe (5432) n'était requis.
      Retour :

### 2.3 L'API répond
```bash
curl -s http://localhost:4000/ready        # ou https://api.ton-domaine/ready
```
- [ ] Réponse `{"ready":true,"checks":{"database":"ok","storage":"ok","antivirus":"..."}}`.
      Retour :

### 2.4 Le site s'ouvre
- [ ] J'ouvre l'URL de l'app (ex. `https://copper.forgenet.fr` ou `http://localhost:3000`) →
      la page de connexion s'affiche.
      Retour :

---

## 3. Connexion & santé

### 3.1 Connexion admin
- [ ] Je me connecte avec l'email/mot de passe admin → j'arrive sur le **Drive**.
      Retour :

### 3.2 Bandeau d'état
- [ ] Si l'antivirus est activé mais pas prêt, un **bandeau orange** prévient (« Antivirus …
      offline »). Sinon, aucun bandeau (normal).
      Retour :

---

## 4. Drive (fichiers & dossiers)

### 4.1 Upload + barre de progression
- [ ] Bouton **Upload** → je choisis un fichier (idéalement gros, ex. 50–200 Mo) → une
      **barre de progression** s'affiche, puis le fichier apparaît.
      Retour :

### 4.2 Chiffrement au repos (preuve)
Crée un fichier texte avec une chaîne unique, uploade-le, puis vérifie qu'elle n'apparaît
pas en clair sur le disque :
```bash
# remplace le chemin par ton STORAGE_PATH (.env)
sudo grep -rl "MA_CHAINE_UNIQUE_123" /var/lib/opencoperlock/storage ; echo "code=$?"
```
- [ ] La commande ne trouve **rien** (code=1) → le contenu est bien chiffré sur disque.
      Retour :

### 4.3 Téléchargement
- [ ] **Download** sur le fichier → le fichier récupéré est **identique** à l'original.
      Retour :

### 4.4 Dossiers & navigation
- [ ] **New folder** crée un dossier ; je clique dessus pour y entrer ; le fil d'Ariane
      (Home / … ) permet de revenir.
      Retour :

### 4.5 Quota
- [ ] En haut à droite, l'usage (`X / Y`) augmente après upload et **diminue** après
      suppression.
      Retour :

### 4.6 Suppression
- [ ] **Delete** sur un fichier → il disparaît et le quota se libère.
      Retour :

---

## 5. Renommer / déplacer

- [ ] **Rename** sur un fichier → nouveau nom pris en compte.
      Retour :
- [ ] **Move** sur un fichier → choisir un dossier cible (numéro) → le fichier y est déplacé.
      Retour :
- [ ] **Rename** / **Move** sur un dossier fonctionne aussi.
      Retour :
- [ ] Déplacer un dossier **dans lui-même / un sous-dossier** est refusé (message d'erreur).
      Retour :

---

## 6. Versions de fichiers texte

- [ ] J'uploade `notes.txt`, puis je ré-uploade un `notes.txt` modifié (même nom, même
      dossier) → le Drive affiche **toujours un seul** fichier (pas de doublon).
      Retour :
- [ ] Bouton **Versions** sur ce fichier → la version précédente est listée.
      Retour :
- [ ] Je **restaure** la version → le contenu courant redevient l'ancien (et l'actuel est
      conservé comme nouvelle version).
      Retour :
- [ ] Un fichier **non-texte** (ex. image) ré-uploadé avec le même nom crée un **second**
      fichier (pas de versionning) — comportement attendu.
      Retour :

---

## 7. Liens de partage

Sur une ligne de fichier/dossier : bouton **Share**. Onglet **Shares** pour gérer.

### 7.1 Partage public, page d'aperçu
- [ ] Share fichier → accès **« anyone »**, type **« preview page »** → le lien est copié.
      Je l'ouvre en **navigation privée** (déconnecté) → je vois l'aperçu (image/PDF/texte/…)
      et le bouton Download.
      Retour :

### 7.2 Lien « fichier brut »
- [ ] Share avec type **« raw file »** → le lien ouvre directement le fichier (image/PDF
      inline, autres en téléchargement).
      Retour :

### 7.3 Partage protégé par code
- [ ] Share avec **« anyone with a code »** + un code → le destinataire doit saisir le code ;
      mauvais code refusé, bon code → accès.
      Retour :

### 7.4 Partage réservé aux comptes
- [ ] Share **« account holders »** → un visiteur déconnecté est invité à se connecter ; un
      utilisateur connecté de l'instance peut l'ouvrir.
      Retour :

### 7.5 Partage de dossier
- [ ] Share sur un **dossier** → la page publique liste les fichiers, chacun téléchargeable.
      Retour :

### 7.6 Expiration / révocation
- [ ] Onglet **Shares** : je **révoque** un lien → il renvoie « Link not found ».
      Retour :
- [ ] (Optionnel) Un lien créé avec une expiration courte affiche « Link expired » une fois
      la date passée.
      Retour :

### 7.7 Garde Zero-Knowledge
- [ ] Tenter de partager un **coffre ZK** ou un fichier dedans est **refusé**.
      Retour :

---

## 8. Quick-Upload (dépôt par code, sans compte)

### 8.1 Créer un code (admin)
- [ ] Admin → **Quick-Upload codes** → **Generate code** (ex. limite d'usage 5) → un code
      s'affiche.
      Retour :

### 8.2 Déposer en invité
- [ ] J'ouvre **`/q`** (déconnecté), je saisis le code → zone de dépôt → j'uploade un
      fichier → succès. Le fichier apparaît côté admin (Drive).
      Retour :

### 8.3 Anti-abus
- [ ] Avec un code protégé par mot de passe, plusieurs essais de **mauvais** mot de passe
      finissent par un **bannissement temporaire** (429) depuis la même IP.
      Retour :

---

## 9. Remote-Upload (téléchargement par lien, côté serveur)

### 9.1 Téléchargement d'un lien public
- [ ] Onglet **Remote** → je colle une URL publique d'un fichier → le job passe à **DONE** et
      le fichier apparaît dans le Drive.
      Retour :

### 9.2 Garde SSRF
- [ ] Je colle `http://127.0.0.1/` (ou `http://169.254.169.254/`) → **refusé** (adresse
      privée/réservée).
      Retour :

---

## 10. Coffre Zero-Knowledge

### 10.1 Créer un coffre + déposer
- [ ] Onglet **Vault** → **New vault** → je saisis une **phrase de passe** → j'uploade un
      fichier (chiffré dans le navigateur) → il apparaît.
      Retour :

### 10.2 Verrouiller / déverrouiller / télécharger
- [ ] En revenant, le coffre demande la phrase de passe ; avec la bonne, je vois les noms
      déchiffrés et je peux **télécharger** (contenu identique à l'original).
      Retour :

### 10.3 Serveur aveugle
- [ ] Vérifie qu'un fichier de coffre n'est pas lisible sur le serveur (même test grep que
      4.2 sur son contenu en clair → rien trouvé).
      Retour :

### 10.4 Sel par coffre
- [ ] Je crée **deux** coffres → chacun fonctionne indépendamment avec sa propre phrase de
      passe (techniquement chacun a son sel ; rien de visible à faire, juste que tout marche).
      Retour :

---

## 11. Sécurité du compte (2FA, codes de secours, sessions)

Menu : clic sur ton **email** (en haut à droite) → page **Account**. (App d'authentification
requise : Google Authenticator, Authy, etc.)

### 11.1 Activer la 2FA
- [ ] **Enable two-factor** → je scanne le **QR code** (ou saisis le secret) → je tape le code
      à 6 chiffres → la 2FA s'active et **10 codes de secours** s'affichent (je les note).
      Retour :

### 11.2 Connexion avec 2FA
- [ ] Je me déconnecte et me reconnecte → après le mot de passe, on me demande le **code à 6
      chiffres** ; un mauvais code est refusé, le bon me connecte.
      Retour :

### 11.3 Code de secours
- [ ] À l'invite 2FA, je saisis un **code de secours** à la place → ça marche **une fois** ;
      le réutiliser échoue.
      Retour :

### 11.4 Régénérer / désactiver
- [ ] **Regenerate recovery codes** (mot de passe requis) donne un nouveau lot.
      Retour :
- [ ] **Disable two-factor** (mot de passe requis) → la connexion ne demande plus de code.
      Retour :

### 11.5 Sessions
- [ ] **Active sessions** liste mes sessions avec **IP** + appareil + dernière activité, la
      session courante est marquée. En me connectant depuis un autre navigateur, elle apparaît.
      Retour :
- [ ] **Revoke** sur une autre session la déconnecte ; **Sign out other sessions** ne garde
      que l'appareil courant.
      Retour :

### 11.6 IP correcte derrière nginx (si topologie 1 ou 2)
- [ ] L'**IP** affichée dans les sessions est ma **vraie IP** (pas `127.0.0.1` ni l'IP de
      nginx). (Le wizard a posé `TRUST_PROXY=1` et `API_HOST=127.0.0.1`.)
      Retour :

---

## 12. Administration

Onglet **Admin** (visible car compte ADMIN).

- [ ] **Stats** : nombre d'utilisateurs, fichiers, stockage utilisé, cap global.
      Retour :
- [ ] **Créer un utilisateur** (email + mot de passe ≥ 12) → il apparaît dans la liste.
      Retour :
- [ ] **Quota** sur un utilisateur → je fixe une valeur en Gio.
      Retour :
- [ ] **Disable / Enable** un utilisateur ; **Delete** un utilisateur.
      Retour :
- [ ] **Global storage cap** : je le modifie et **Save**.
      Retour :
- [ ] **Alertes** : si je mets un cap global très bas (proche de l'usage), une **alerte**
      apparaît ; idem si un fichier est marqué infecté.
      Retour :
- [ ] **Audit log** : les actions récentes (login, upload, share, …) sont listées.
      Retour :
- [ ] Nouvel utilisateur : je me connecte avec → il **ne voit pas** l'onglet Admin et ne
      voit que ses propres fichiers.
      Retour :

---

## 13. RGPD (données personnelles)

Page **Account** → section « Your data ».

- [ ] **Export my data** → télécharge un **JSON** avec profil, dossiers, métadonnées des
      fichiers, partages, sessions, activité récente.
      Retour :
- [ ] **Delete my account** (mot de passe requis) sur un **compte de test** → le compte et ses
      fichiers sont supprimés et je suis déconnecté.
      Retour :
- [ ] Le **seul administrateur** ne peut **pas** se supprimer (message d'erreur).
      Retour :

---

## 14. Sécurité de connexion

- [ ] **Brute-force** : 5 tentatives de connexion avec un mauvais mot de passe → la 6e est
      **bloquée (429)**, même avec le bon mot de passe, pendant un moment.
      Retour :
- [ ] (Avancé / optionnel) Sans le bon en-tête CSRF, une requête de modification est refusée
      (403). Difficile à tester sans outils ; ignore si tu veux.
      Retour :

---

## 15. Sauvegarde & restauration

Sur la VM (nécessite `pg_dump`/`pg_restore`, installés avec PostgreSQL) :

### 15.1 Sauvegarde
```bash
./scripts/backup.sh ./backups
ls -lh ./backups
```
- [ ] Une archive `opencoperlock-<date>.tar.gz` est créée.
      Retour :

### 15.2 Restauration (sur une VM de test de préférence)
```bash
pm2 stop opencoperlock-api
./scripts/restore.sh ./backups/opencoperlock-<date>.tar.gz   # taper "restore" pour confirmer
pm2 start opencoperlock-api
```
- [ ] Après restauration, je me reconnecte et mes fichiers se **téléchargent toujours**
      correctement (le `MASTER_KEY` du `.env` doit être le même qu'au moment du backup).
      Retour :

---

## 16. Mise à jour / redéploiement

```bash
git pull
./scripts/deploy.sh
pm2 reload ecosystem.config.cjs
```
- [ ] La mise à jour applique les migrations et recharge l'app sans tout casser.
      Retour :

---

## 17. (Optionnel, pour devs) Contrôles automatiques

Sur une machine de dev avec les dépendances installées :
```bash
pnpm install
pnpm -r typecheck
pnpm -r lint
# tests : nécessite une base de test (DATABASE_URL)
DATABASE_URL=postgresql://user:pass@localhost:5432/ocl_test pnpm -r test
```
- [ ] `typecheck`, `lint` ✅ et la suite de tests passe (≈ 77 tests).
      Retour :

---

## Remarques générales / bugs divers

Note ici tout ce qui n'entre pas dans une case ci-dessus (ergonomie, lenteurs, textes à
améliorer, idées) :

-
-
-
