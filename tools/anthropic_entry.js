// Point d'entrée du SDK officiel Anthropic pour l'appli (regroupé par esbuild dans
// vendor/anthropic-sdk.js : l'appli reste en scripts classiques, ouverte en file://).
import Anthropic from '@anthropic-ai/sdk';

window.Anthropic = Anthropic;
