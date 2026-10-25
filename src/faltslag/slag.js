// De inbyggda fältslagen, i svårighetsordning. Korten ligger i slag.json (formatet beskrivs i slagkort.js).
import KORT from './slag.json';
import { readSlagkort } from './slagkort.js';

export const SLAG = KORT.map(readSlagkort);

export const slagById = (id) => SLAG.find((s) => s.id === id) || null;
