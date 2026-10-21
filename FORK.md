# Particularités du fork OmaCal

Base intégrée : [crmne/omarchy-calendar](https://github.com/crmne/omarchy-calendar),
révision `95ee533b28bb9e273185dfc5b3bcdb92df25d01f` (1.2.1).
Le [README](README.md) reprend sa documentation, sans maintenir une seconde copie.
Cette fiche prévaut pour les différences ci-dessous.

## Installation et connexion

Le dépôt est `https://github.com/pomartel/omacal.git`, branche `google-calendar`,
et l’identifiant installé reste `pomartel.omacal`.
Installez `googleworkspace-cli`, puis connectez le compte avec
`gws auth login -s calendar`. Dans les réglages du plugin, indiquez ce même
compte dans `googleAccount`.

Google est activé par défaut ; HEY, les flux et les suggestions de lieux sont
désactivés jusqu’à leur activation explicite. L’horloge utilise `fr_CA`.
Les identifiants IPC du README deviennent `pomartel.omacal` dans ce fork :

```sh
omarchy-shell pomartel.omacal toggle
omarchy-shell pomartel.omacal newEvent
omarchy-shell pomartel.omacal settings
omarchy-shell pomartel.omacal refresh
```

Le backend upstream réutilise l’authentification de `gws`, puis appelle Google
Calendar directement en HTTPS. Le compte configuré est vérifié avant les
lectures et écritures. Aucun secret n’est enregistré dans le cache.

## Comportements conservés

- Interface française et dates saisies en français ou en anglais.
- Champs Qt natifs : accents, touches mortes, Compose, sélection et annulation.
  La restriction upstream de lecture du presse-papiers ne s’applique donc pas.
- Ouverture du panneau sur l’écran actif ; ajout rapide avec `Alt+Shift+Space`.
- Flèches ou `H J K L` pour choisir le jour, `Ctrl` + flèches pour changer de
  mois, `E` ou `1` à `9` pour modifier un événement et `?` pour l’aide complète.
- Anciens identifiants de calendriers Google reconnus après la migration.
- Cache hors ligne dans `$XDG_CACHE_HOME/omacal` (sinon `~/.cache/omacal`),
  séparé par compte et fuseau : 32 semaines, 4 Mio, 30 jours au maximum.
  Chaque écriture réussie invalide les semaines ; une lecture commencée avant
  cette invalidation ne peut pas les réintroduire. Actualisation par défaut
  toutes les cinq minutes, avec conservation des données en cas de panne.

## Entretien

Les traductions françaises se modifient dans `i18n/fr.json`, puis se génèrent
avec `python3 tools/build-translations`. `i18n/Fr.js` est l’adaptateur généré,
chargé synchroniquement par QML et les modèles JavaScript. Ne pas le modifier
à la main. Les messages avec des données utilisent des paramètres `%1`, `%2`.
Le français reste explicite, indépendamment de la langue du shell.
Les mots reconnus par les parseurs de dates, les identifiants techniques et
les métadonnées du manifeste ne sont pas des traductions d’interface.

`backends/google.py` conserve le transport et les conversions upstream.
`backends/google_profile.py` isole la vérification du compte et les points
d’enregistrement du cache ; `backends/cache.py` gère les instantanés.
`KeyField.qml` adapte les champs natifs à l’interface attendue par upstream.
Les protections contre les réponses périmées restent dans `Source.qml`.

```sh
tests/run
node tests/sources/run.js
tests/check-french-input
omarchy plugin validate "$PWD"
```

Les tests utilisent des données synthétiques. Le test de saisie nécessite
Qt 6 et un compilateur C++ ; il ne remplace pas un essai physique du clavier.
Conserver les licences et [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
