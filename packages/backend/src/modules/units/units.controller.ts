import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UnitsService } from './units.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('units')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('units')
export class UnitsController {
  constructor(private service: UnitsService) {}

  @Get()
  @ApiOperation({ summary: 'List all units (optionally filter by organizationId)' })
  findAll(@Query('organizationId') organizationId?: string) {
    return this.service.findAll(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get unit by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a unit' })
  create(@Body() body: Partial<any>) {
    return this.service.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a unit' })
  update(@Param('id') id: string, @Body() body: Partial<any>) {
    return this.service.update(id, body);
  }

  @Put(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a unit' })
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}
