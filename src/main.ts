import Phaser from 'phaser';import './style.css';import {gameConfig} from './gameConfig';
const game=new Phaser.Game(gameConfig);(window as unknown as {__MEME_FIGHT__?:Phaser.Game}).__MEME_FIGHT__=game;
