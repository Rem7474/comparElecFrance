# ⚡ ComparatifElec

Application web 100% front-end (HTML/CSS/JS) pour analyser la consommation électrique Enedis, comparer les tarifs (Base, HP/HC, Tempo, TCH) et simuler le photovoltaïque.

## ✅ Démarrage rapide
```powershell
cd c:\Code\comparatifElec
python -m http.server 8000
# Ouvrir http://localhost:8000
```

## 🧭 Utilisation
1. Ouvrez `index.html` dans votre navigateur.
2. Importez un fichier JSON (ou XLSX) de consommation.
3. Lancez l'analyse et comparez les offres.
4. Ajustez les paramètres PV pour estimer les économies.

## 📁 Structure
```
index.html
style.css
script.js
src/
tariffs/
```

## 🔒 Sécurité & limites
- Tout est local (aucun envoi serveur).
- Auth Enedis requise dans le navigateur.
- Couleurs Tempo futures estimées si l'API ne répond pas.

## 🛠️ Dev
- Modules modernes dans `src/`.
- `script.js` reste legacy.

## 📌 Notes
- Si besoin d'une doc plus détaillée, dites-moi ce que vous voulez garder et je la recrée proprement.