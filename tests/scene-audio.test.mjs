import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneAudio } from '../js/scene-audio-model.js';

test('scene audio preserves loop preferences without replaying one-shot effects',()=>{
  const settings={ambience:{url:'https://example.com/forest.ogg',volume:.3,stopped:false},music:{url:'https://example.com/theme.mp3',volume:.8,stopped:true}};
  assert.deepEqual(sceneAudio({...settings,sfx:{url:'https://example.com/bang.wav',stopped:false}}),settings);
  assert.deepEqual(sceneAudio(JSON.parse(JSON.stringify(settings))),settings);
});

test('old scenes default to silence and invalid audio settings are discarded',()=>{
  const silent={url:'',volume:1,stopped:true};
  assert.deepEqual(sceneAudio(null),{ambience:silent,music:silent});
  assert.deepEqual(sceneAudio({ambience:{url:'javascript:alert(1)',volume:-1,stopped:false},music:{url:'https://example.com/song.ogg',volume:2}}),{
    ambience:silent,music:{url:'https://example.com/song.ogg',volume:1,stopped:true}
  });
});
