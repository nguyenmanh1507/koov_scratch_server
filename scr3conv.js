/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 */

"use strict";

let debug = require('debug')('test');

// convert sequence of blocks.
const convert_blocks = (blocks, id, env) => {
  let acc = [];

  while (id) {
    acc.push(convert_block(blocks, id, env));
    id = blocks[id].next;
  }
  return acc;
};

// convert single block.
const convert_block = (blocks, id, env) => {
  const block = blocks[id];
  const f = k => block.fields[k].value;
  const c = k => convert_block(blocks, block.inputs[k].block, env);
  const cs = k => convert_blocks(blocks, block.inputs[k].block, env);
  const maybe_numeric = k => {
    const v = c(k);
    switch (typeof v) {
    case 'string':
      return Number(v);
    default:
      return v;
    }
  };
  const use_port = (part, block) => {
    if (part === 'multi-led')
      env.port_settings.RGB = part;
    else {
      block.port = c('PORT');
      env.port_settings[block.port] = part;
    }
    return block;
  };
  const binop = (op, prefix) => ({
    name: op,
    x: maybe_numeric(`${prefix}1`),
    y: maybe_numeric(`${prefix}2`)
  });
  const variable = () => {
    const vname = f('VARIABLE');
    if (!env.variables.includes(vname))
      env.variables.push(vname);
    return vname;
  };
  const use_variable = (name) => {
    return {
      name: name,
      variable: variable(),
      value: maybe_numeric('VALUE')
    };
  };

  switch (block.opcode) {
  case 'event_whenflagclicked':
    return {
      name: 'when-green-flag-clicked',
      blocks: convert_blocks(blocks, block.next, env)
    };

  case 'control_repeat':
    return {
      name: 'repeat',
      count: c('TIMES'),
      blocks: cs('SUBSTACK')
    }
  case 'control_if':
    return {
      name: 'if-then',
      condition: c('CONDITION'),
      blocks: cs('SUBSTACK')
    };
  case 'control_if_else':
    return {
      name: 'if-then-else',
      condition: c('CONDITION'),
      'then-blocks': cs('SUBSTACK'),
      'else-blocks': cs('SUBSTACK2')
    };
  case 'control_repeat_until':
    return {
      name: 'repeat-until',
      condition: c('CONDITION'),
      blocks: cs('SUBSTACK')
    }
  case 'control_wait_until':
    return {
      name: 'wait-until',
      condition: c('CONDITION'),
      blocks: cs('SUBSTACK')
    }
  case 'control_wait': return { name: 'wait', secs: c('DURATION') };

  case 'operator_add': return binop('plus', 'NUM');
  case 'operator_subtract': return binop('minus', 'NUM');
  case 'operator_multiply': return binop('multiply', 'NUM');
  case 'operator_divide': return binop('divide', 'NUM');
  case 'operator_lt': return binop('less-than?', 'OPERAND');
  case 'operator_equals': return binop('equal?', 'OPERAND');
  case 'operator_gt': return binop('greater-than?', 'OPERAND');
  case 'operator_and': return binop('and', 'OPERAND');
  case 'operator_or': return binop('or', 'OPERAND');
  case 'operator_not': return { name: 'not', x: c('OPERAND') };
  case 'operator_mod': return binop('mod', 'NUM');
  case 'operator_round': return { name: 'round', x: maybe_numeric('NUM') };
  case 'operator_random':
    return {
      name: 'pick-random',
      from: maybe_numeric('FROM'),
      to: maybe_numeric('TO')
    };
  case 'operator_mathop':
    return {
      name: 'math',
      op: c('OPERATOR'),
      x: maybe_numeric('NUM')
    };

  case 'data_variable':
    return {
      name: 'variable-ref',
      variable: variable()
    };
  case 'data_setvariableto':
    return {
      name: 'set-variable-to',
      variable: variable(),
      value: maybe_numeric('VALUE')
    };
  case 'data_changevariableby':
    return {
      name: 'change-variable-by',
      variable: variable(),
      value: maybe_numeric('VALUE')
    };

  case 'sensing_timer': return { name: 'timer' };
  case 'sensing_resettimer': return { name: 'reset-timer' };

  case 'koov_vport_menu':       // deprecated
  case 'koov_kport_menu':       // deprecated
  case 'koov_dcport_menu':      // deprecated
    return f('PORT');
  case 'koov.menu.digialOutputPort':
    return f('digialOutputPort');
  case 'koov.menu.dcMotorPort':
    return f('dcMotorPort');
  case 'koov.menu.analogInputPort':
    return f('analogInputPort');
  case 'koov.menu.i2cPort':
    return f('i2cPort');
  case 'koov_bport_menu':       // deprecated
    return f('BUTTON');
  case 'koov.menu.coreButtonPort':
    {
      const v = f('coreButtonPort');
      const map = { UP: 'A0', RIGHT: 'A1', BOTTOM: 'A2', LEFT: 'A3' };
      return map[v] || v;
    }
  case 'koov_onoff_menu':       // deprecated
    return f('MODE');
  case 'koov.menu.modeOnOff':
    return f('modeOnOff');
  case 'koov_brake_menu':       // deprecated
    return f('MODE');
  case 'koov.menu.dcMotorStopMode':
    return f('dcMotorStopMode');
  case 'koov_direction2_menu':  // deprecated
  case 'koov_direction3_menu':  // deprecated
    return f('DIRECTION');
  case 'koov.menu.dcMotorDirection':
    return f('dcMotorDirection');
  case 'koov.menu.3dAxis':
    return f('3dAxis');

  case 'koov_turn_led':         // deprecated
  case 'koov.turnLED':
    return use_port('led', {
      name: 'turn-led',
      mode: c('MODE')
    });
  case 'koov_multi_led':        // deprecated
  case 'koov.multiLED':
    return use_port('multi-led', {
      name: 'multi-led',
      r: maybe_numeric('R'),
      g: maybe_numeric('G'),
      b: maybe_numeric('B')
    });
  case 'koov_buzzer_on':        // deprecated
  case 'koov.buzzerOn':
    return use_port('buzzer', {
      name: 'buzzer-on',
      frequency: maybe_numeric('FREQUENCY')
    });
  case 'koov_buzzer_off':       // deprecated
  case 'koov.buzzerOff':
    return use_port('buzzer', {
      name: 'buzzer-off'
    });
  case 'koov_dcmotor_power':    // deprecated
  case 'koov.dcMotorPower':
    return use_port('dc-motor', {
      name: 'set-dcmotor-power',
      power: maybe_numeric('POWER')
    });
  case 'koov_dcmotor_on':       // deprecated
  case 'koov.dcMotorOn':
    return use_port('dc-motor', {
      name: 'turn-dcmotor-on',
      direction: c('DIRECTION')
    });
  case 'koov_dcmotor_off':      // deprecated
  case 'koov.dcMotorOff':
    return use_port('dc-motor', {
      name: 'turn-dcmotor-off',
      mode: c('MODE')
    });
  case 'koov_servomotor_degree': // deprecated
  case 'koov.setServoMotorDegree':
    return use_port('servo-motor', {
      name: 'set-servomotor-degree',
      degree: maybe_numeric('DEGREE')
    });
  case 'koov_servomotor_synchronized_motion': // deprecated
  case 'koov.servoMotorSynchronizedMotion':
    return {
      name: 'servomotor-synchronized-motion',
      speed: maybe_numeric('SPEED'),
      blocks: cs('SUBSTACK')
    };

  case 'koov_light_sensor':     // deprecated
  case 'koov.getLightSensor':
    return use_port('light-sensor', {
      name: 'light-sensor-value'
    });
  case 'koov_sound_sensor':     // deprecated
  case 'koov.getSoundSensor':
    return use_port('sound-sensor', {
      name: 'sound-sensor-value'
    });
  case 'koov_ir_photo_reflector': // deprecated
  case 'koov.getIrPhotoReflector':
    return use_port('ir-photo-reflector', {
      name: 'ir-photo-reflector-value'
    });
  case 'koov_touch_sensor':     // deprecated
  case 'koov.getTouchSensor':
    return use_port('touch-sensor', {
      name: 'touch-sensor-value'
    });
  case 'koov_core_button':      // deprecated
  case 'koov.getCoreButton':
    return use_port('push-button', {
      name: 'button-value'
    });
  case 'koov_accelerometer':    // deprecated
  case 'koov.getAccelerometer':
    return use_port('3-axis-digital-accelerometer', {
      name: '3-axis-digital-accelerometer-value',
      direction: c('DIRECTION')
    });

  case 'text':
    return f('TEXT');

  case 'math_number':
  case 'math_whole_number':
  case 'math_positive_number':
    return Number(f('NUM'));

  default:
    return block.opcode;
  }
};

const scratch3_sprite = project => {
  const targets = project.targets;
  const sprite = targets.filter(x => Object.keys(x.blocks).length > 0);
  const blocks = sprite[0].blocks;
  const toplevel = Object.keys(blocks).filter(x => {
    return blocks[x].topLevel && !blocks[x].shadow;
  });

  return { blocks: blocks, id: toplevel };
};

const scratch3_translate = (blocks, toplevel) => {
  const env = {
    port_settings: {},
    variables: [],
    lists: []
  };
  const script = convert_block(blocks, toplevel, env);

  return {
    scripts: [
      script
    ].concat(env.variables.map(name => ({
      name: 'variable',
      variable: name,
      value: 0
    }))).concat(env.lists.map(name => ({
      name: 'list',
      list: name,
      value: []
    }))),
    'port-settings': env.port_settings
  };
};

module.exports = {
    scratch3_sprite: scratch3_sprite,
    scratch3_translate: scratch3_translate
};
