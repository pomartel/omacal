# OmaCal — Google Agenda pour Omarchy

Horloge et calendrier en français canadien, avec les événements de Google Agenda
via le Google Workspace CLI (`gws`). Ce fork de
[OmaCal](https://github.com/crmne/omacal) conserve les licences et les crédits
d’origine. Google Agenda est son unique service de calendrier.

## Configuration

Installez `python3` et `gws`, puis connectez `gws` au compte Google avec accès à
Agenda. Dans l’entrée `pomartel.omacal` de `~/.config/omarchy/shell.json`, indiquez
l’adresse de ce compte :

```json
{
  "id": "pomartel.omacal",
  "googleAccount": "vous@example.com",
  "locale": "fr_CA"
}
```

L’adresse doit correspondre au compte utilisé par `gws`. Redémarrez le shell
après la configuration : `omarchy restart shell`.

## Fonctionnalités

- Grille mensuelle avec numéros de semaine et pastilles par calendrier.
- Vue de la journée, événements sur plusieurs jours et liens de réunion.
- Prochain événement dans la barre et rappels dans les notifications du bureau.
- Ajout d’événements depuis le calendrier ou avec `Alt + Shift + Space`.
- Suppression confirmée des événements ponctuels modifiables. Les événements
  récurrents et ceux avec des invités se gèrent dans Google Agenda.
- Calendriers sélectionnés dans Google Agenda, couleurs et droits d’accès.
- Navigation et saisie des dates au clavier, en français ou en anglais.
- Raccourcis du calendrier sur l’écran actif.

Google développe les occurrences récurrentes. Les rappels proviennent des
événements ou des réglages du calendrier ; les rappels par courriel restent
à la charge de Google.

## Cache et actualisation

Les événements et les calendriers sont conservés dans `~/.cache/omacal/`, dans
un cache distinct par compte et fuseau horaire. Aucun identifiant de connexion
n’est enregistré par le plugin.

Le cache est restauré au démarrage, avant l’actualisation réseau. Les données
restent affichées si Google est inaccessible, avec la date du cache. Le cache
est limité à 32 semaines, 4 Mio et 30 jours. L’actualisation périodique se fait
par défaut toutes les cinq minutes ; le bouton Actualiser ou `R` la force.
Une création ou une suppression invalide le cache persistant.

Les appels à `gws` ont une durée et une taille de réponse limitées. Après une
modification qui expire sans confirmation, actualisez avant de réessayer.

## Raccourcis

```bash
omarchy-shell pomartel.omacal toggle
omarchy-shell pomartel.omacal newEvent
omarchy-shell pomartel.omacal settings
omarchy-shell pomartel.omacal refresh
```

Dans le calendrier :

| Touche | Action |
|---|---|
| Flèches ou `H J K L` | Sélectionner un jour |
| `Ctrl` + flèches | Changer de mois avec la sélection |
| `[` / `]` | Mois précédent / suivant |
| `{` / `}` | Année précédente / suivante |
| `Home`, `Entrée`, `Espace`, `T` | Aujourd’hui |
| `N` | Nouvel événement |
| `S` | Paramètres |
| `R` | Actualiser |
| `O` | Ouvrir la journée dans Google Agenda |
| `W` | Changer le premier jour de la semaine |
| `?` | Aide clavier |
| `Échap` | Fermer |

## Réglages

Les paramètres sont enregistrés dans l’entrée du widget de `shell.json`.

| Clé | Valeur par défaut | Effet |
|---|---|---|
| `googleAccount` | `""` | Compte Google utilisé par `gws` |
| `locale` | `"fr_CA"` | Langue de l’horloge |
| `barEvent` | `"soon"` | `soon`, `name`, `time`, `next` ou `off` |
| `alertLeadMinutes` | `15` | Préavis des événements sans rappel |
| `notifications` | `true` | Notifications des rappels |
| `timeFormat` | `"auto"` | `auto`, `24` ou `12` |
| `refreshIntervalSec` | `300` | Intervalle d’actualisation |
| `hiddenCalendars` | `""` | Noms à masquer, séparés par des virgules |
| `quickAddShortcut` | `"ALT + SHIFT + SPACE"` | Raccourci d’ajout rapide |

`lastCalendarId` mémorise le calendrier du dernier ajout. Les anciens réglages
`backend` et `liveSync` sont ignorés.

## Développement

`Model.js` conserve le modèle de l’horloge Omarchy. `Calendar.js` gère les dates,
les événements et les rappels ; `backends/Google.js` construit les commandes et
`backends/google.py` traduit les réponses Google. `backends/cache.py` gère les
instantanés persistants.

```bash
tests/run          # Modèle, commandes Google et cache
tests/qml-smoke    # Interface, démarrage hors ligne et suppression simulée
```

Les tests QML utilisent un faux `gws` et ne modifient pas votre calendrier.
Voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) et [LICENSE](LICENSE).

## Intégration upstream du 3 octobre 2026

Les rappels utilisent une déduplication atomique entre écrans, une icône de la couleur du calendrier et transportent leur texte hors des arguments de processus. Les changements HEY de fuseaux, d’édition et de dates de fin inclusives ne s’appliquent pas au backend Google : les dates de fin Google restent exclusives et les événements s’ouvrent dans Google Agenda.

## Intégration upstream du 21 octobre 2026

Révision intégrée : `95ee533b28bb9e273185dfc5b3bcdb92df25d01f`. Intégration en un commit linéaire, conformément aux règles du dépôt ; les commits du fork ne sont pas réécrits.

Édition des événements Google, événements sur plusieurs jours, fuseaux horaires et flux de calendrier intégrés. Google reste activé par défaut, HEY et les flux restent désactivés tant qu’ils ne sont pas choisis. Les suggestions de lieux sont désactivées par défaut. Le compte Google configuré est vérifié avant les opérations ; le cache local, la navigation française et le routage vers l’écran actif sont conservés.

Les champs natifs Qt sont conservés pour les accents, les touches mortes, Compose, les méthodes de saisie, la sélection et l’annulation. Le remplacement upstream par un éditeur de touches personnalisé est volontairement écarté. Les champs natifs gardent donc le comportement Qt de lecture du presse-papiers ; la protection upstream qui supprime ces lectures automatiques n’est pas applicable à cette variante.

`tests/check-french-input` vérifie la préédition et la validation de `ê`, `é` et `à` dans les vrais composants, avec des données synthétiques. Ce test requiert les outils de développement Qt 6 et un compilateur C++. Il ne remplace pas un essai physique du clavier.

La documentation upstream est conservée dans [UPSTREAM.md](UPSTREAM.md) ; ses limitations de saisie ne concernent pas cette variante native.
